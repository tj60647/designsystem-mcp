/**
 * Design System MCP — Chat Route
 * Author: Thomas J McLeish
 * License: MIT
 *
 * POST /api/chat
 *
 * OpenRouter-backed multi-agent agentic loop.  Each request goes through
 * two steps:
 *
 *   Step 1 — Orchestrator routing
 *     A single fast LLM call classifies the user intent and returns a
 *     delegate_to_agent tool call routing to "reader", "builder", or
 *     "generator".  If the client supplies previousAgent the routing step
 *     is skipped entirely (continuation of the same conversation).
 *
 *   Step 2 — Specialist agentic loop
 *     The specialist agent receives only the tools relevant to its role and
 *     runs its own tool-call loop until it returns a final text response or
 *     MAX_ITERATIONS is reached.
 *
 * Progress is streamed to the client via Server-Sent Events so the UI shows
 * live feedback ("Thinking…", "Calling get_component…") rather than a
 * silent spinner.
 *
 * The generate_design_system tool is handled inline here (not via runMcpTool)
 * so it can share the request AbortController and return generated data back
 * in the SSE "done" payload.
 */

import express from "express";
import { runMcpTool } from "../toolRunner.js";
import { generateDesignSystem } from "../generator.js";
import { ingest } from "../ingestService.js";
import {
  OPENROUTER_TOOLS,
  CHAT_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  SPECIALIST_CONFIGS,
  DELEGATE_TOOL,
  type SpecialistName,
} from "../agentConfig.js";
import { recordRequest, recordCacheHit, recordRouting } from "../metrics.js";

const router = express.Router();

const ALLOWED_MESSAGE_ROLES = new Set(["user", "assistant"]);

// ── Response cache ────────────────────────────────────────────────────────────
// Caches the "done" payload for each unique (normalised) user question so that
// repeated identical questions skip the LLM round-trip entirely.  The cache is
// intentionally simple and in-process — no persistence across restarts.
//
// Responses that involved `generate_design_system` are never cached because
// that tool mutates the server-side design-system data store.
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS  = 60 * 60 * 1_000; // 60 minutes
const CACHE_MAX     = 200;

type CacheEntry = { payload: Record<string, unknown>; timestamp: number };
const responseCache = new Map<string, CacheEntry>();

/** Normalise a user message into a stable cache key. */
function normalizeCacheKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function getCachedResponse(key: string): Record<string, unknown> | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCachedResponse(key: string, payload: Record<string, unknown>): void {
  if (responseCache.size >= CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { payload, timestamp: Date.now() });
}

/** Clear all cached entries — call when the design-system data store changes. */
export function clearResponseCache(): void {
  responseCache.clear();
  console.log("[chat:cache] cache cleared");
}

type AgentRuntimeKey = "orchestrator" | SpecialistName | "unified";
type AgentRuntimeSettings = {
  model: string;
  temperature: number;
  /** Client-supplied system prompt override. Falls back to SPECIALIST_CONFIGS default when absent. */
  systemPrompt?: string;
  /** Client-supplied max-iterations override. Falls back to SPECIALIST_CONFIGS default when absent. */
  maxIterations?: number;
  /** Client-supplied list of enabled tool names. Falls back to the full specialist tool set when absent. */
  tools?: string[];
};
type AgentSettingsPayload = {
  useGlobalModel?: unknown;
  global?: Partial<AgentRuntimeSettings>;
  agents?: Partial<Record<AgentRuntimeKey, Partial<AgentRuntimeSettings>>>;
};

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Hard ceiling on client-supplied maxIterations to prevent runaway loops. */
const MAX_ALLOWED_ITERATIONS = 10;
/** Hard ceiling on client-supplied systemPrompt length (chars) to prevent token-cost abuse. */
const MAX_SYSTEM_PROMPT_LEN = 8_000;
/** Hard ceiling on client-supplied tools array length before allowlist filtering. */
const MAX_TOOLS_OVERRIDE_LEN = 50;

function normalizeAgentSettings(
  payload: AgentSettingsPayload | undefined,
  defaultModel: string,
): { useGlobalModel: boolean; global: AgentRuntimeSettings; agents: Record<AgentRuntimeKey, AgentRuntimeSettings> } {
  const makeEntry = (src: Partial<AgentRuntimeSettings> | undefined): AgentRuntimeSettings => {
    const entry: AgentRuntimeSettings = {
      model: typeof src?.model === "string" && src.model.trim() ? src.model.trim() : defaultModel,
      temperature: toNumber(src?.temperature, 0),
    };
    if (typeof src?.systemPrompt === "string" && src.systemPrompt.trim()) {
      entry.systemPrompt = src.systemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT_LEN);
    }
    if (typeof src?.maxIterations === "number" && Number.isInteger(src.maxIterations)
        && src.maxIterations >= 1 && src.maxIterations <= MAX_ALLOWED_ITERATIONS) {
      entry.maxIterations = src.maxIterations;
    }
    if (Array.isArray(src?.tools) && src.tools.length > 0 && src.tools.length <= MAX_TOOLS_OVERRIDE_LEN
        && src.tools.every((t) => typeof t === "string")) {
      entry.tools = src.tools as string[];
    }
    return entry;
  };

  const global = makeEntry(payload?.global);
  const agents = {
    orchestrator: makeEntry(payload?.agents?.orchestrator),
    reader: makeEntry(payload?.agents?.reader),
    builder: makeEntry(payload?.agents?.builder),
    generator: makeEntry(payload?.agents?.generator),
    "style-guide": makeEntry(payload?.agents?.["style-guide"]),
    unified: makeEntry(payload?.agents?.unified),
  };

  return {
    useGlobalModel: Boolean(payload?.useGlobalModel ?? true),
    global,
    agents,
  };
}

function buildSamplingParams(runtime: AgentRuntimeSettings): { temperature?: number; top_p?: number; top_k?: number } {
  // Temperature-only sampling keeps behaviour predictable across providers.
  return { temperature: runtime.temperature };
}

// ── Response parser ───────────────────────────────────────────────────────
// Parse the LLM's JSON response into {message, preview}.  Falls back to
// treating the raw text as the message if JSON parsing fails, so a
// non-compliant model reply still works rather than throwing.
// ─────────────────────────────────────────────────────────────────────────
function parseChatResponse(raw: string): { message: string; preview: string | null; metadata: Record<string, unknown> | null; schemaVersion: string } {
  const text = raw.trim();

  // Attempt to extract a {message, preview} object from the text using several
  // strategies, in order of specificity.  Models sometimes emit prose before or
  // after the JSON, so we scan the whole string rather than requiring it to start
  // at position 0.
  function tryParse(candidate: string): { message: string; preview: string | null; metadata: Record<string, unknown> | null; schemaVersion: string } | null {
    try {
      const parsed = JSON.parse(candidate) as { message?: unknown; preview?: unknown; metadata?: unknown; schemaVersion?: unknown };
      if (typeof parsed !== "object" || parsed === null) return null;
      const message = typeof parsed.message === "string" ? parsed.message : null;
      if (!message) return null;
      const preview = typeof parsed.preview === "string" && parsed.preview.trim() ? parsed.preview.trim() : null;
      const metadata = parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
        ? parsed.metadata as Record<string, unknown>
        : null;
      const schemaVersion = typeof parsed.schemaVersion === "string" && parsed.schemaVersion.trim()
        ? parsed.schemaVersion.trim()
        : "1.0";
      return { message, preview, metadata, schemaVersion };
    } catch {
      return null;
    }
  }

  // 1. Whole text is JSON
  const r1 = tryParse(text);
  if (r1) return r1;

  // 2. Code fence: ```json … ``` or ``` … ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const r2 = tryParse(fenced[1].trim());
    if (r2) return r2;
  }

  // 3. Scan forward from the first '{' to find a balanced JSON object anywhere
  //    in the response (handles models that prepend a prose sentence).
  const brace = text.indexOf("{");
  if (brace !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = brace; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      const r3 = tryParse(text.slice(brace, end + 1));
      if (r3) return r3;
    }
  }

  // 4. Nothing parseable — return the raw text as the message.
  return { message: raw, preview: null, metadata: null, schemaVersion: "fallback-text" };
}

// ── POST /api/chat ────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "OpenRouter not configured. Set OPENROUTER_API_KEY environment variable.",
    });
    return;
  }

  const { messages, model: requestedModel, previousAgent, agentSettings: rawAgentSettings } = req.body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    model?: string;
    /** Agent name from the previous turn, sent by the client to skip re-routing. */
    previousAgent?: string;
    agentSettings?: AgentSettingsPayload;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required and must not be empty." });
    return;
  }

  // Enforce that every message has a permitted role to prevent system-prompt injection.
  const invalidRole = messages.find((m) => !ALLOWED_MESSAGE_ROLES.has(m.role));
  if (invalidRole) {
    res.status(400).json({ error: `Invalid message role: "${invalidRole.role}". Only "user" and "assistant" are permitted.` });
    return;
  }

  // Enforce that every message content is a plain string.
  const invalidContent = messages.find((m) => typeof m.content !== "string");
  if (invalidContent) {
    res.status(400).json({ error: "Each message must have a string \"content\" field." });
    return;
  }

  const model = requestedModel ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-20b:nitro";
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-20b:nitro";
  const agentSettings = normalizeAgentSettings(rawAgentSettings, model);
  const getAgentRuntime = (key: AgentRuntimeKey): AgentRuntimeSettings => {
    if (agentSettings.useGlobalModel) return agentSettings.global;
    return agentSettings.agents[key] ?? agentSettings.global;
  };

  async function readOpenRouterError(response: Response): Promise<string> {
    const errText = await response.text();
    try {
      const errJson = JSON.parse(errText) as { error?: { message?: string } };
      return errJson.error?.message || errText;
    } catch {
      return errText;
    }
  }

  // Stream progress updates via Server-Sent Events
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Prevent Nginx / Heroku routing mesh from buffering the stream.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  recordRequest();

  const sendEvent       = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const sendProgress    = (message: string) => sendEvent({ type: "progress", message });
  const endWithDone     = (payload: object) => { sendEvent({ type: "done", ...payload }); res.end(); };
  const endWithError    = (error: string)   => { sendEvent({ type: "error", error }); res.end(); };
  /** Emitted once after the orchestrator picks a specialist. */
  const sendAgentRouted = (agent: string, reason: string, model: string) =>
    sendEvent({ type: "agent_routed", agent, reason, model });
  /** Emitted just before each MCP tool is called — client renders this live. */
  const sendToolCall    = (callId: string, tool: string, args: Record<string, unknown>) =>
    sendEvent({ type: "tool_call", callId, tool, args });
  /** Emitted after each tool returns — client appends result metadata to the live row. */
  const sendToolResult  = (callId: string, tool: string, chars: number, preview: string) =>
    sendEvent({ type: "tool_result", callId, tool, chars, preview });
  /** Emitted when the model emits a thinking/reasoning block or narrating prose before tool calls. */
  const sendReasoning   = (iteration: number, content: string) =>
    sendEvent({ type: "reasoning", iteration, content });

  type OpenRouterMessage = {
    role: string;
    content: string | null;
    tool_calls?: unknown[];
    tool_call_id?: string;
    name?: string;
  };

  const toolCallsUsed: string[] = [];

  // Accumulated token usage and cost across the orchestrator call and every
  // specialist iteration.  OpenRouter follows the OpenAI response format and
  // includes a `usage` object on every completion response.
  type UsageTotals = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
  };
  const totalUsage: UsageTotals = {
    promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0,
    cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
  };

  type OpenRouterUsage = {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number; audio_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;

  function addUsage(raw: { usage?: OpenRouterUsage } | null): void {
    if (!raw?.usage) return;
    totalUsage.promptTokens     += raw.usage.prompt_tokens     ?? 0;
    totalUsage.completionTokens += raw.usage.completion_tokens ?? 0;
    totalUsage.totalTokens      += raw.usage.total_tokens      ?? 0;
    totalUsage.cost             += raw.usage.cost              ?? 0;
    totalUsage.cachedTokens     += raw.usage.prompt_tokens_details?.cached_tokens     ?? 0;
    totalUsage.cacheWriteTokens += raw.usage.prompt_tokens_details?.cache_write_tokens ?? 0;
    totalUsage.reasoningTokens  += raw.usage.completion_tokens_details?.reasoning_tokens ?? 0;
  }

  // ── Cache lookup ──────────────────────────────────────────────────────────
  // Check whether this exact question has already been answered.  If so, emit
  // the cached payload immediately and skip the LLM round-trip entirely.
  // ─────────────────────────────────────────────────────────────────────────
  const cacheKey = normalizeCacheKey(messages.at(-1)!.content);
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    console.log(`[chat:cache] hit for key="${cacheKey.slice(0, 80)}"`);
    recordCacheHit();
    recordRouting((cached as Record<string, unknown>).routedAgent as string ?? "unified");
    sendProgress("Answering from cache…");
    endWithDone({ ...cached, fromCache: true });
    return;
  }

  // Abort the whole loop after a generous timeout. Progress is streamed so
  // the user sees activity. Keep a hard minimum of 5 minutes so long-running
  // tool chains and generation tasks are not cut off too early.
  const CHAT_TIMEOUT_MS = Math.max(300_000, Number(process.env.CHAT_TIMEOUT_MS ?? 300_000));
  const chatAbort = new AbortController();
  const chatTimer = setTimeout(() => chatAbort.abort(), CHAT_TIMEOUT_MS);

  type ThinkingStep =
    | { type: "reasoning"; content: string }
    | { type: "tool_call"; tool: string; args: string };
  const thinkingSteps: ThinkingStep[] = [];

  // ── Step 1: Orchestrator routing ────────────────────────────────────────
  // Call the Orchestrator with tool_choice:"required" so it must call
  // delegate_to_agent.  Fall back to unified single-agent mode if routing
  // fails; the unified mode uses CHAT_SYSTEM_PROMPT and all tools so every
  // capability remains available even when orchestration is unavailable.
  //
  // If the client supplies a valid previousAgent, skip the orchestrator
  // entirely — short follow-up messages (e.g. "yes, go ahead") would
  // otherwise be mis-classified as a new topic.
  // ─────────────────────────────────────────────────────────────────────────
  let routedAgent: SpecialistName | "unified" = "unified";
  let systemPrompt = CHAT_SYSTEM_PROMPT;
  type AnyTool = { type: string; function: { name: string; description: string; parameters: unknown } };
  let agentTools: AnyTool[] = OPENROUTER_TOOLS as unknown as AnyTool[];
  let MAX_ITERATIONS = 8;
  let activeRuntime = getAgentRuntime("unified");
  let hasRetriedWithFallbackModel = false;

  if (typeof previousAgent === "string" && previousAgent in SPECIALIST_CONFIGS) {
    const prev = previousAgent as SpecialistName;
    routedAgent    = prev;
    systemPrompt   = SPECIALIST_CONFIGS[prev].systemPrompt;
    agentTools     = SPECIALIST_CONFIGS[prev].tools;
    MAX_ITERATIONS = SPECIALIST_CONFIGS[prev].maxIterations;
    activeRuntime  = getAgentRuntime(prev);
    // Apply any client-supplied overrides for this specialist
    if (activeRuntime.systemPrompt) systemPrompt = activeRuntime.systemPrompt;
    if (activeRuntime.maxIterations !== undefined) MAX_ITERATIONS = activeRuntime.maxIterations;
    if (activeRuntime.tools && activeRuntime.tools.length > 0) {
      const allowed = new Set(activeRuntime.tools);
      const filtered = SPECIALIST_CONFIGS[prev].tools.filter((t) => allowed.has(t.function.name)) as unknown as AnyTool[];
      if (filtered.length > 0) agentTools = filtered;
    }
    console.log(`[chat:orchestrator] reusing previousAgent="${prev}" (skip re-route)`);
  } else {
    try {
      sendProgress("Routing request…");
      const orchestratorRuntime = getAgentRuntime("orchestrator");
      const orchMessages: OpenRouterMessage[] = [
        { role: "system", content: ORCHESTRATOR_SYSTEM_PROMPT },
        messages.at(-1)!,
      ];
      const orchResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/designsystem-mcp-demo",
          "X-Title": "Design System MCP Demo",
        },
        body: JSON.stringify({
          model: orchestratorRuntime.model,
          ...buildSamplingParams(orchestratorRuntime),
          messages: orchMessages,
          tools: [DELEGATE_TOOL],
          tool_choice: "required",
        }),
        signal: chatAbort.signal,
      });
      if (orchResponse.ok) {
        const orchData = await orchResponse.json() as {
          choices: Array<{ message: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
          usage?: OpenRouterUsage;
        };
        addUsage(orchData);
        const delegateCall = orchData.choices?.[0]?.message?.tool_calls?.[0];
        if (delegateCall?.function?.name === "delegate_to_agent") {
          let delegateArgs: { agent?: string; reason?: string } = {};
          try {
            delegateArgs = JSON.parse(delegateCall.function.arguments) as { agent?: string; reason?: string };
          } catch (parseErr) {
            console.warn("[chat:orchestrator] failed to parse delegate_to_agent arguments:", String(parseErr), delegateCall.function.arguments);
          }
          const agent = delegateArgs.agent as SpecialistName | undefined;
          if (agent && agent in SPECIALIST_CONFIGS) {
            routedAgent    = agent;
            systemPrompt   = SPECIALIST_CONFIGS[agent].systemPrompt;
            agentTools     = SPECIALIST_CONFIGS[agent].tools;
            MAX_ITERATIONS = SPECIALIST_CONFIGS[agent].maxIterations;
            activeRuntime  = getAgentRuntime(agent);
            // Apply any client-supplied overrides for this specialist
            if (activeRuntime.systemPrompt) systemPrompt = activeRuntime.systemPrompt;
            if (activeRuntime.maxIterations !== undefined) MAX_ITERATIONS = activeRuntime.maxIterations;
            if (activeRuntime.tools && activeRuntime.tools.length > 0) {
              const allowed = new Set(activeRuntime.tools);
              const filtered = SPECIALIST_CONFIGS[agent].tools.filter((t) => allowed.has(t.function.name)) as unknown as AnyTool[];
              if (filtered.length > 0) agentTools = filtered;
            }
            console.log(`[chat:orchestrator] routed to "${agent}" — ${delegateArgs.reason ?? ""}`);
            sendAgentRouted(agent, delegateArgs.reason ?? "", activeRuntime.model);
          }
        }
      } else {
        const orchErr = await readOpenRouterError(orchResponse);
        if (orchResponse.status === 402 && activeRuntime.model !== fallbackModel) {
          activeRuntime = { ...activeRuntime, model: fallbackModel };
          hasRetriedWithFallbackModel = true;
          sendProgress(`Selected model unavailable for routing. Using fallback model (${fallbackModel}).`);
          console.warn(`[chat:orchestrator] non-ok response 402 (${orchErr}). Falling back to unified agent with model="${fallbackModel}"`);
        } else {
          sendProgress("Routing unavailable — continuing in general mode.");
          console.warn(`[chat:orchestrator] non-ok response ${orchResponse.status} (${orchErr}), falling back to unified agent`);
        }
      }
    } catch (err) {
      sendProgress("Routing unavailable — continuing in general mode.");
      console.warn("[chat:orchestrator] routing failed, falling back to unified agent:", String(err));
    }
  }

  // ── Step 2: Specialist (or unified fallback) agentic loop ───────────────
  const loopMessages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  let generatedDesignSystemData: Record<string, unknown> | null = null;

  type ContentBlock =
    | { type: "thinking"; thinking: string }
    | { type: "text"; text: string }
    | { type: string; [key: string]: unknown };

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      console.log(`[chat] iteration=${i} model=${activeRuntime.model} messages=${loopMessages.length}`);

      sendProgress(i === 0 ? "Thinking…" : `Thinking (step ${i + 1})…`);

      const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/designsystem-mcp-demo",
          "X-Title": "Design System MCP Demo",
        },
        body: JSON.stringify({
          model: activeRuntime.model,
          ...buildSamplingParams(activeRuntime),
          messages: loopMessages,
          tools: agentTools,
          tool_choice: "auto",
        }),
        signal: chatAbort.signal,
      });

      if (!orResponse.ok) {
        const errMsgBody = await readOpenRouterError(orResponse);
        if (
          orResponse.status === 402 &&
          !hasRetriedWithFallbackModel &&
          activeRuntime.model !== fallbackModel
        ) {
          hasRetriedWithFallbackModel = true;
          activeRuntime = { ...activeRuntime, model: fallbackModel };
          sendProgress(`Selected model unavailable. Retrying with fallback model (${fallbackModel})…`);
          console.warn(`[chat] model payment/availability issue (402: ${errMsgBody}). Retrying with fallback model="${fallbackModel}"`);
          continue;
        }

        clearTimeout(chatTimer);
        const errMsg = `OpenRouter API error (${orResponse.status}): ${errMsgBody}`;
        endWithError(errMsg);
        return;
      }

      const orData = await orResponse.json() as {
        choices: Array<{
          message: {
            role: string;
            content: string | Array<ContentBlock> | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason: string;
        }>;
        usage?: OpenRouterUsage;
      };
      addUsage(orData);

      const choice = orData.choices[0];
      if (!choice) {
        clearTimeout(chatTimer);
        endWithError("OpenRouter returned no choices.");
        return;
      }

      const assistantMessage = choice.message;

      // Extract text content and any reasoning blocks (thinking-capable models
      // like Claude return an array of content blocks)
      let assistantTextContent: string | null = null;
      if (Array.isArray(assistantMessage.content)) {
        for (const block of assistantMessage.content as ContentBlock[]) {
          if (block.type === "thinking" && block.thinking) {
            thinkingSteps.push({ type: "reasoning", content: block.thinking as string });
            sendReasoning(i, block.thinking as string);
          } else if (block.type === "text" && block.text) {
            assistantTextContent = (assistantTextContent ?? "") + block.text;
          }
        }
      } else {
        assistantTextContent = assistantMessage.content;
      }

      // If the model narrates its plan before calling tools (e.g. "I'll look up
      // the button tokens first"), stream that as reasoning so it shows in the
      // live trace alongside the tool calls that follow.
      if (assistantTextContent && assistantMessage.tool_calls?.length) {
        sendReasoning(i, assistantTextContent);
      }

      loopMessages.push({
        ...assistantMessage,
        content: assistantTextContent,
      } as OpenRouterMessage);

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch {
            toolArgs = {};
          }

          if (!toolCallsUsed.includes(toolName)) toolCallsUsed.push(toolName);

          thinkingSteps.push({ type: "tool_call", tool: toolName, args: toolCall.function.arguments });

          console.log(`[chat:tool] calling ${toolName}`, JSON.stringify(toolArgs));

          if (toolName === "generate_design_system") {
            sendProgress("Generating design system — this may take a few minutes…");
          } else {
            sendProgress(`Calling \`${toolName}\`…`);
          }
          sendToolCall(toolCall.id, toolName, toolArgs);

          let toolResult: string;

          // ── Special handling: generate_design_system ─────────────────
          // Handled inline (not via runMcpTool) so the generation respects
          // the request AbortController and the result is included in the
          // SSE "done" payload for the UI to display.
          if (toolName === "generate_design_system") {
            // Send periodic keep-alive progress events so the SSE connection
            // stays alive and the user sees that work is still in progress.
            const HEARTBEAT_MESSAGES = [
              "Still generating…",
              "Crafting tokens and color scales…",
              "Building component definitions…",
              "Defining themes and icons…",
            ];
            let heartbeatCount = 0;
            const heartbeat = setInterval(() => {
              sendProgress(HEARTBEAT_MESSAGES[heartbeatCount % HEARTBEAT_MESSAGES.length]);
              heartbeatCount++;
            }, 15_000);

            try {
              const description = (toolArgs.description as string) ?? "";
              const result = await generateDesignSystem(
                description,
                apiKey,
                activeRuntime.model,
                chatAbort.signal,
                (msg) => sendProgress(msg),
              );
              clearInterval(heartbeat);

              const ingestResult = await ingest(
                "chat:generate_design_system",
                "design-system",
                result.data as Record<string, unknown>,
              );
              const loadedSections = ingestResult.loaded;

              // A new design system was loaded — previous cached responses
              // about tokens/components/etc. are now stale.
              clearResponseCache();

              // Only include generatedDesignSystem and fire gallery refresh if
              // at least one section was successfully ingested.
              if (loadedSections.length > 0) {
                generatedDesignSystemData = result.data;
              }

              const ingestErrors = ingestResult.errors.map((e) => e.message);
              toolResult = JSON.stringify({
                success:        loadedSections.length > 0,
                message:        loadedSections.length > 0
                  ? "Design system generated and loaded successfully."
                  : "Design system generation succeeded but no sections could be loaded.",
                sectionsLoaded: loadedSections,
                componentCount: Object.keys((result.data.components ?? {}) as object).length,
                themeCount:     Object.keys((result.data.themes    ?? {}) as object).length,
                iconCount:      Object.keys((result.data.icons     ?? {}) as object).length,
                warnings:       result.warnings,
                ...(ingestErrors.length > 0 ? { errors: ingestErrors } : {}),
              });
            } catch (genErr) {
              clearInterval(heartbeat);
              clearTimeout(chatTimer);
              endWithError(`Design system generation failed: ${String(genErr)}`);
              return;
            }
          } else {
            // ── Standard tool execution ──────────────────────────────
            try {
              toolResult = await runMcpTool(toolName, toolArgs);
            } catch (toolErr) {
              toolResult = JSON.stringify({ error: String(toolErr) });
            }
          }

          loopMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: toolResult,
          });
          const resultPreview = toolResult.length > 500 ? toolResult.slice(0, 500) + "…" : toolResult;
          sendToolResult(toolCall.id, toolName, toolResult.length, resultPreview);
          console.log(`[chat:tool] result for ${toolName}:`, resultPreview);
        }
        continue;
      }

      // No tool calls — return the final answer
      const rawResponse = assistantTextContent ?? "";
      const { message, preview, metadata, schemaVersion } = parseChatResponse(rawResponse);
      console.log("[chat:response]", message.slice(0, 300));
      console.log(`[chat:usage] prompt=${totalUsage.promptTokens} (cached=${totalUsage.cachedTokens} cacheWrite=${totalUsage.cacheWriteTokens}) completion=${totalUsage.completionTokens} (reasoning=${totalUsage.reasoningTokens}) total=${totalUsage.totalTokens} cost=${Number.isFinite(totalUsage.cost) ? totalUsage.cost.toFixed(6) : "n/a"} credits`);
      clearTimeout(chatTimer);
      // Store in cache unless the design system was generated (that tool
      // mutates the data store so subsequent queries would return stale data).
      if (!toolCallsUsed.includes("generate_design_system")) {
        setCachedResponse(cacheKey, { message, preview, metadata, schemaVersion, model: activeRuntime.model, routedAgent, toolCallsUsed, thinkingSteps, usage: totalUsage });
      }
      recordRouting(routedAgent);
      endWithDone({ message, preview, metadata, schemaVersion, model: activeRuntime.model, routedAgent, toolCallsUsed, thinkingSteps, generatedDesignSystem: generatedDesignSystemData, usage: totalUsage });
      return;
    }

    // Reached max iterations without a final text response
    const lastAssistant = [...loopMessages].reverse().find((m: OpenRouterMessage) => m.role === "assistant" && m.content);
    const rawLast = String(lastAssistant?.content ?? "");
    const { message: lastMessage, preview: lastPreview, metadata: lastMetadata, schemaVersion: lastSchemaVersion } = parseChatResponse(rawLast);
    clearTimeout(chatTimer);
    recordRouting(routedAgent);
    endWithDone({ message: lastMessage, preview: lastPreview, metadata: lastMetadata, schemaVersion: lastSchemaVersion, model: activeRuntime.model, routedAgent, toolCallsUsed, thinkingSteps, generatedDesignSystem: generatedDesignSystemData, usage: totalUsage });
  } catch (err) {
    clearTimeout(chatTimer);
    console.error("Chat error:", err);
    const isTimeout = (err as { name?: string }).name === "AbortError";
    const errMessage = (err as { message?: string }).message;
    endWithError(
      isTimeout
        ? "The AI took too long to respond. Please try a simpler question or try again."
        : `Internal server error during chat${errMessage ? `: ${errMessage}.` : "."}`,
    );
  }
});

export default router;
