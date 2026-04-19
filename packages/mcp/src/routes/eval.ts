/**
 * Design System MCP — Eval Metrics Route
 * Author: Thomas J McLeish
 * License: MIT
 *
 * Routes:
 *   GET  /api/eval/metrics        — return current in-process counters
 *   POST /api/eval/metrics/reset  — zero all counters
 *   POST /api/eval/judge          — LLM-as-judge quality score for a prompt/response pair
 */

import express from "express";
import { getMetrics, resetMetrics } from "../metrics.js";

// ── Judge constants ───────────────────────────────────────────────────────────
const JUDGE_TIMEOUT_MS = 30_000;
const MAX_JUDGE_RESPONSE_CHARS = 3_000;

const JUDGE_SYSTEM_PROMPT = `You are an impartial quality evaluator for an AI design-system assistant.
You will be given a USER PROMPT and the ASSISTANT RESPONSE.
Score the response from 1 to 10 using these criteria:

  Relevance    — Does the response directly address what the user asked?
  Accuracy     — Is the information factually correct and free of hallucination?
  Completeness — Does it cover all important aspects of the question?
  Clarity      — Is it well-structured and easy to understand?

Return ONLY a JSON object — no markdown fences, no extra text — in exactly this format:
{"score": <integer 1-10>, "reasoning": "<one or two sentences explaining the score>"}`;

const router = express.Router();

// ── GET /api/eval/metrics ─────────────────────────────────────────────────
router.get("/eval/metrics", (_req, res) => {
  res.json(getMetrics());
});

// ── POST /api/eval/metrics/reset ──────────────────────────────────────────
router.post("/eval/metrics/reset", (_req, res) => {
  resetMetrics();
  res.json({ ok: true, resetAt: new Date().toISOString() });
});

// ── POST /api/eval/judge ──────────────────────────────────────────────────
// Body: { prompt: string, response: string, model?: string }
// Returns: { score: number (1–10), reasoning: string }
router.post("/eval/judge", async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "OpenRouter not configured. Set OPENROUTER_API_KEY environment variable." });
    return;
  }

  const { prompt, response, model: requestedModel } = req.body as {
    prompt?: unknown;
    response?: unknown;
    model?: unknown;
  };

  if (typeof prompt !== "string" || prompt.trim() === "") {
    res.status(400).json({ error: "\"prompt\" must be a non-empty string." });
    return;
  }
  if (typeof response !== "string" || response.trim() === "") {
    res.status(400).json({ error: "\"response\" must be a non-empty string." });
    return;
  }

  const model = (typeof requestedModel === "string" && requestedModel.trim())
    ? requestedModel.trim()
    : (process.env.OPENROUTER_JUDGE_MODEL ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-20b:nitro");

  const trimmedResponse = response.trim().slice(0, MAX_JUDGE_RESPONSE_CHARS);
  const truncated = response.trim().length > MAX_JUDGE_RESPONSE_CHARS;
  const userMessage = `USER PROMPT:\n${prompt.trim()}\n\nASSISTANT RESPONSE:\n${trimmedResponse}${truncated ? "\n[...response truncated for evaluation]" : ""}`;

  const judgeAbort = new AbortController();
  const judgeTimer = setTimeout(() => judgeAbort.abort(), JUDGE_TIMEOUT_MS);

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/designsystem-mcp-demo",
        "X-Title": "Design System MCP Demo",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user",   content: userMessage },
        ],
      }),
      signal: judgeAbort.signal,
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      res.status(502).json({ error: `OpenRouter error ${orRes.status}: ${errText}` });
      return;
    }

    const data = await orRes.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content ?? "";
    let score: number;
    let reasoning: string;

    try {
      // Strip optional markdown fences before parsing
      const cleaned = raw.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
      const parsed = JSON.parse(cleaned) as { score?: unknown; reasoning?: unknown };
      const num = Number(parsed.score);
      score     = Number.isFinite(num) ? Math.min(10, Math.max(1, Math.round(num))) : 5;
      reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : String(parsed.reasoning ?? "");
    } catch {
      // Fallback: extract digits from raw text
      const numMatch = raw.match(/\b([1-9]|10)\b/);
      score     = numMatch ? Number(numMatch[1]) : 5;
      reasoning = raw.slice(0, 300) || "Unable to parse judge response.";
    }

    res.json({ score, reasoning });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  } finally {
    clearTimeout(judgeTimer);
  }
});

export default router;
