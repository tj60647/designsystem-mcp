/**
 * Design System MCP — Agent Info & Prompt Templates Routes
 * Author: Thomas J McLeish
 * License: MIT
 *
 * Routes:
 *   GET /api/agent-info      — machine-readable description of all five agents
 *   GET /prompt-templates    — DEPRECATED: legacy prompt template list
 */

import express from "express";
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  SPECIALIST_CONFIGS,
  DELEGATE_TOOL,
} from "../agentConfig.js";

const router = express.Router();

// ── GET /api/agent-info ───────────────────────────────────────────────────
// Returns a machine-readable description of all five Strategy-3 agents:
// Orchestrator, Design System Reader, Component Builder, System Generator,
// and Style Guide.
// Each entry includes the agent's name, role, system prompt, parameters,
// and the exact tool subset it is given.
// Used by the "View Agents" modal in the demo UI.
// ─────────────────────────────────────────────────────────────────────────
router.get("/api/agent-info", (req, res) => {
  const requestedModel = typeof req.query.model === "string" && req.query.model.trim().length > 0
    ? req.query.model.trim()
    : undefined;
  const model = requestedModel ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-20b:nitro";
  res.json({
    model,
    modelSource: requestedModel ? "request" : (process.env.OPENROUTER_MODEL ? "env" : "default"),
    agents: [
      {
        key: "orchestrator",
        name: "Orchestrator",
        description: "Classifies the user's intent in a single LLM call and routes to the correct specialist agent. Never answers the user directly.",
        expectedInput: "Latest user message text from POST /api/chat.",
        expectedOutput: "One required tool call: delegate_to_agent({ agent, reason }). No direct user answer text.",
        model,
        parameters: {
          maxIterations: 1,
          toolChoice: "required",
          temperature: 0,   // deterministic: design system queries should return consistent, grounded answers
          endpoint: "POST https://openrouter.ai/api/v1/chat/completions",
        },
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        tools: [
          {
            name: DELEGATE_TOOL.function.name,
            description: DELEGATE_TOOL.function.description,
            parameters: DELEGATE_TOOL.function.parameters,
          },
        ],
      },
      {
        key: "reader",
        name: "Design System Reader",
        description: "Answers questions about tokens, components, themes, icons, layout, and accessibility using read-only MCP tools. Never mutates the design system.",
        expectedInput: "User + assistant message history and routed intent (reader). Uses read-only MCP tools.",
        expectedOutput: "Final assistant JSON object: { \"schemaVersion\": \"1.0\", \"message\": string, \"preview\"?: string, \"metadata\"?: object } (plain-text fallback accepted by parser).",
        model,
        parameters: {
          maxIterations: SPECIALIST_CONFIGS.reader.maxIterations,
          toolChoice: "auto",
          temperature: 0,
          endpoint: "POST https://openrouter.ai/api/v1/chat/completions",
        },
        systemPrompt: SPECIALIST_CONFIGS.reader.systemPrompt,
        tools: SPECIALIST_CONFIGS.reader.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
      {
        key: "builder",
        name: "Component Builder",
        description: "Generates HTML/CSS component code grounded in exact design system tokens. Validates all props and token values before emitting code.",
        expectedInput: "User + assistant message history and routed intent (builder). Uses component/token/validation tools.",
        expectedOutput: "Final assistant JSON object: { \"schemaVersion\": \"1.0\", \"message\": string, \"preview\": \"<html>...\", \"metadata\"?: object }.",
        model,
        parameters: {
          maxIterations: SPECIALIST_CONFIGS.builder.maxIterations,
          toolChoice: "auto",
          temperature: 0,
          endpoint: "POST https://openrouter.ai/api/v1/chat/completions",
        },
        systemPrompt: SPECIALIST_CONFIGS.builder.systemPrompt,
        tools: SPECIALIST_CONFIGS.builder.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
      {
        key: "generator",
        name: "System Generator",
        description: "Gathers brand requirements through conversation then generates a complete new design system (tokens, components, themes, icons) via AI.",
        expectedInput: "User + assistant message history and routed intent (generator). May call generate_design_system.",
        expectedOutput: "When generating: tool result with generatedDesignSystem payload; final assistant response follows { \"schemaVersion\": \"1.0\", \"message\": string, \"preview\"?: string, \"metadata\"?: object }.",
        model,
        parameters: {
          maxIterations: SPECIALIST_CONFIGS.generator.maxIterations,
          toolChoice: "auto",
          temperature: 0,
          generateDesignSystemTemperature: 0.4,
          generateDesignSystemMaxTokens: 8000,
          endpoint: "POST https://openrouter.ai/api/v1/chat/completions",
        },
        systemPrompt: SPECIALIST_CONFIGS.generator.systemPrompt,
        tools: SPECIALIST_CONFIGS.generator.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
      {
        key: "style-guide",
        name: "Style Guide",
        description: "Explains design principles, color usage rules, typography guidelines, and composition patterns from the style guide. Grounds answers in actual style guide content and token values.",
        expectedInput: "User + assistant message history and routed intent (style-guide). Uses style-guide/token/contrast tools.",
        expectedOutput: "Final assistant JSON object: { \"schemaVersion\": \"1.0\", \"message\": string, \"preview\"?: string, \"metadata\"?: object } with guidance-focused content.",
        model,
        parameters: {
          maxIterations: SPECIALIST_CONFIGS["style-guide"].maxIterations,
          toolChoice: "auto",
          temperature: 0,
          endpoint: "POST https://openrouter.ai/api/v1/chat/completions",
        },
        systemPrompt: SPECIALIST_CONFIGS["style-guide"].systemPrompt,
        tools: SPECIALIST_CONFIGS["style-guide"].tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ],
  });
});

// ── GET /prompt-templates ─────────────────────────────────────────────────
// DEPRECATED in v0.3.0 — use MCP Prompts primitive instead.
// Retained for backward compatibility.  Use MCP prompts/list and
// prompts/get via any MCP client instead.
// ─────────────────────────────────────────────────────────────────────────
router.get("/prompt-templates", (_req, res) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</mcp>; rel="successor-version"');
  res.json({
    templates: [
      {
        id: "login-form",
        title: "Create a login form",
        description: "Generate a login form using design system components and tokens",
        prompt: "Create a login form with email, password fields and a primary submit button",
      },
      {
        id: "primary-colors",
        title: "List primary colors",
        description: "Discover primary color tokens in the design system",
        prompt: "What primary color tokens are available in the design system?",
      },
      {
        id: "button-variants",
        title: "Button variants",
        description: "Explore button variants and their token usage",
        prompt: "Show me all the button variants and their token usage",
      },
      {
        id: "dark-mode",
        title: "Dark mode tokens",
        description: "Find token overrides for implementing dark mode",
        prompt: "What token overrides are needed to implement dark mode?",
      },
      {
        id: "accessible-input",
        title: "Accessible input",
        description: "Build an accessible input field with error state",
        prompt: "Create an accessible input field with error state and helper text",
      },
      {
        id: "card-badge",
        title: "Card with badge",
        description: "Combine a card component with a badge overlay",
        prompt: "Create a card component with a success badge in the top right corner",
      },
      {
        id: "spacing-scale",
        title: "Spacing scale",
        description: "Find the right spacing tokens for a comfortable form",
        prompt: "What spacing tokens should I use for a form with comfortable padding?",
      },
      {
        id: "navigation-bar",
        title: "Navigation bar",
        description: "Design a navigation bar using design system tokens",
        prompt: "Design a navigation bar using only design system tokens",
      },
      {
        id: "alert-notification",
        title: "Alert / notification",
        description: "Build an alert or notification banner with status variants",
        prompt: "Create an alert component with success, warning, error, and info variants using design system tokens",
      },
      {
        id: "typography-scale",
        title: "Typography scale",
        description: "Explore available typography tokens and usage",
        prompt: "Show me the typography tokens — sizes, weights, and line-heights — and when to use each",
      },
      {
        id: "icon-search",
        title: "Search icons",
        description: "Find icons available in the design system",
        prompt: "What icons are available in the design system? Show me navigation and action icons",
      },
      {
        id: "token-compliance",
        title: "Token compliance check",
        description: "Check whether common CSS values match design tokens",
        prompt: "Check these CSS values for token compliance: color #2563eb, font-size 16px, border-radius 8px, padding 16px",
      },
      {
        id: "pricing-card",
        title: "Pricing card",
        description: "Build a pricing card component using design system tokens",
        prompt: "Create a pricing card with a plan name, price, feature list, and a primary CTA button using design system tokens",
      },
    ],
  });
});

export default router;
