/**
 * Design System MCP — MCP Server, Tool, Resource, and Prompt Definitions
 * Author: Thomas J McLeish
 * License: MIT
 *
 * Defines the MCP server and registers all six primitive types:
 *   - Tools (27): executable functions for querying design system data
 *   - Resources (14 URIs + templates): read-only reference documents
 *   - Prompts (10): reusable parameterized templates for LLM interaction
 *   - Logging: structured log events via notifications/message
 *   - Sampling: server-initiated LLM completions via the client
 *   - Elicitation: interactive user input requests
 *
 * Versioned releases:
 *   v0.1.0 — 13 core tools (tokens, components, validation, search)
 *   v0.2.0 — +13 tools (themes, icons, a11y, component depth, layout, versioning)
 *   v0.3.0 — +1 tool (get_deprecations), Resources, Prompts, Sampling, Elicitation, Logging, Tasks (experimental)
 *   v0.4.0 — +1 tool (get_style_guide), style-guide resource
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getData } from "./dataStore.js";
import { DATA_SCHEMAS } from "./schemas.js";

// ── Types ─────────────────────────────────────────────────────────────────

interface TokenEntry {
  $value: string;
  $type: string;
  $description?: string;
}

type TokenNode = TokenEntry | Record<string, unknown>;

interface TokensData {
  color:        Record<string, TokenNode>;
  typography:   Record<string, TokenNode>;
  spacing:      Record<string, TokenNode>;
  borderRadius: Record<string, TokenNode>;
  shadow:       Record<string, TokenNode>;
  motion:       Record<string, TokenNode>;
  layout:       Record<string, TokenNode>;
}

interface ThemeSpec {
  name: string;
  description: string;
  semantic: Record<string, string>;
}
interface ThemesData {
  [themeKey: string]: ThemeSpec;
}

interface IconSpec {
  name: string;
  category: string;
  keywords: string[];
  sizes: number[];
  description: string;
  svg?: string;
  usage?: string;
}
interface IconsData {
  [iconKey: string]: IconSpec;
}

interface ComponentAnatomySpec {
  root: string;
  slots: Record<string, string>;
  validChildren: string[];
  compositionNotes: string;
}

interface ComponentRelationshipsSpec {
  parent: string | null;
  siblings: string[];
  related: string[];
  children: string[];
  composedIn: string[];
}

interface ComponentSpec {
  name:              string;
  description:       string;
  variants?:         string[];
  variantGuidance?:  Record<string, string>;
  sizes?:            string[];
  states?:           string[];
  props?:            Record<string, unknown>;
  tokens?:           Record<string, unknown>;
  constraints?:      string[];
  accessibility?:    Record<string, unknown>;
  anatomy?:          ComponentAnatomySpec;
  relationships?:    ComponentRelationshipsSpec;
  relatedComponents?: string[];
}

interface ComponentsData {
  [componentKey: string]: ComponentSpec;
}

interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  added: string[];
  changed: string[];
  deprecated: string[];
  removed: string[];
}

interface DeprecationEntry {
  type: string;
  name: string;
  deprecatedSince: string;
  removalVersion: string;
  reason: string;
  migrationPath: string;
  replacements: string[];
}

interface StyleGuideData {
  principles:          Record<string, unknown>[];
  colorUsage:          Record<string, unknown>;
  typographyUsage:     Record<string, unknown>;
  compositionPatterns: Record<string, unknown>[];
}

// ── Utilities ─────────────────────────────────────────────────────────────

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current !== null && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function flattenTokenValues(
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && "$value" in (val as object)) {
      result[fullPath] = (val as TokenEntry).$value;
    } else if (val !== null && typeof val === "object") {
      Object.assign(result, flattenTokenValues(val as Record<string, unknown>, fullPath));
    }
  }
  return result;
}

function extractTokenRefs(obj: unknown, refs: Set<string>): void {
  if (typeof obj === "string" && obj.startsWith("{") && obj.endsWith("}")) {
    refs.add(obj.slice(1, -1));
  } else if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      extractTokenRefs(val, refs);
    }
  }
}

function flattenAllTokens(
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, { value: string; type: string; description?: string }> {
  const result: Record<string, { value: string; type: string; description?: string }> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && "$value" in (val as object)) {
      const entry = val as TokenEntry;
      result[fullPath] = {
        value: entry.$value,
        type: entry.$type,
        ...(entry.$description ? { description: entry.$description } : {}),
      };
    } else if (val !== null && typeof val === "object") {
      Object.assign(result, flattenAllTokens(val as Record<string, unknown>, fullPath));
    }
  }
  return result;
}

function parseHexColor(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(cleaned)) return null;
  const full = cleaned.length === 3
    ? cleaned.split("").map(c => c + c).join("")
    : cleaned;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number | null {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Static guideline content ──────────────────────────────────────────────

const GUIDELINE_ACCESSIBILITY = `# Accessibility Guidelines

## Global Rules
- All interactive elements must be keyboard-operable (WCAG 2.1 SC 2.1.1).
- Focus indicators must be visible with a minimum 3:1 contrast ratio (WCAG 2.1 SC 1.4.11).
- Color must not be the sole means of conveying information (WCAG 2.1 SC 1.4.1).
- All images and icons that convey meaning must have text alternatives (WCAG 2.1 SC 1.1.1).
- Text content must meet a 4.5:1 contrast ratio for normal text, 3:1 for large text (WCAG 2.1 SC 1.4.3).
- Pages must be navigable by keyboard without trapping focus (WCAG 2.1 SC 2.1.2).

## Component Rules
- **Button**: Use \`role="button"\` only on non-\`<button>\` elements. Include \`aria-label\` for icon-only buttons.
- **Input**: Always pair with a visible \`<label>\`. Use \`aria-describedby\` to link helper and error text.
- **Modal**: Trap focus inside while open. Restore focus on close. Use \`aria-modal="true"\` and \`role="dialog"\`.
- **Toast**: Use \`role="alert"\` for errors/warnings and \`role="status"\` for success/info.
- **Navigation**: Wrap in \`<nav aria-label="Main navigation">\`. Mark active page with \`aria-current="page"\`.
- **Checkbox**: Group related checkboxes with \`<fieldset>\`/\`<legend>\`.

## Testing Expectations
- Automated: Run axe-core or similar on every page and component story.
- Manual: Tab through all interactive elements verifying logical order and visible focus.
- Screen reader: Test with VoiceOver (macOS/iOS) and NVDA (Windows).
- Zoom: Verify layouts at 200% browser zoom without horizontal scrolling.

## Tooling
- **axe-core**: Automated accessibility rule engine.
- **Storybook a11y addon**: In-storybook accessibility panel.
- **WebAIM Contrast Checker**: Manual color contrast verification.
- **WAVE**: Browser-based accessibility evaluation tool.
`;

const GUIDELINE_LAYOUT = `# Layout Guidelines

## Grid System
- 12-column grid with 24px gutters on desktop (>=1280px).
- 8-column grid with 16px gutters on tablet (768px-1279px).
- 4-column grid with 16px gutters on mobile (<768px).
- Use the \`layout.grid\` tokens to access column counts and gutter values.

## Breakpoints
| Name | Min Width | Token |
|------|-----------|-------|
| mobile | 0 | layout.breakpoints.mobile |
| tablet | 768px | layout.breakpoints.tablet |
| desktop | 1280px | layout.breakpoints.desktop |
| wide | 1536px | layout.breakpoints.wide |

## Content Max-Widths
- Prose content: 72ch (approx 680px)
- Form panels: 640px
- Full-width containers: Use \`layout.containerMaxWidth\` token (1280px default)
- Dashboard content: 1440px

## Page Gutters
- Mobile: 16px (spacing.4)
- Tablet: 24px (spacing.6)
- Desktop: 32px (spacing.8)

## Region Spacing
- Between major page sections: spacing.16 (64px)
- Between card groups: spacing.8 (32px)
- Between form fields: spacing.4 (16px)
- Between inline elements: spacing.2 (8px)

## Z-Index Scale
Use \`layout.zIndex\` tokens - never set z-index manually.
| Layer | Token | Value |
|-------|-------|-------|
| base | layout.zIndex.base | 0 |
| raised | layout.zIndex.raised | 10 |
| dropdown | layout.zIndex.dropdown | 100 |
| sticky | layout.zIndex.sticky | 200 |
| overlay | layout.zIndex.overlay | 300 |
| modal | layout.zIndex.modal | 400 |
| toast | layout.zIndex.toast | 500 |
`;

const GUIDELINE_CONTENT = `# Content Guidelines

## Voice and Tone
- **Clear and direct**: Use plain language. Prefer active voice. Avoid jargon.
- **Helpful**: Lead with what the user can do, not what they cannot.
- **Concise**: Remove words that do not add meaning. Aim for scannable text.
- **Human**: Write as if talking to the user, not at them.

## Writing Conventions
- Use sentence case for UI labels (e.g. "Save changes", not "Save Changes").
- Use title case only for proper nouns and product names.
- End action labels with a verb ("Save", "Continue", "Delete file").
- For confirmations: state what will happen ("Delete this item? This cannot be undone.").
- For empty states: explain why empty and what to do ("No results. Try adjusting your filters.").
- For error messages: explain what went wrong and how to fix it.

## Terminology
- Use "sign in" / "sign out" (not "log in" / "log out").
- Use "email address" (not "email").
- Use "optional" for non-required fields.
- Use "loading" for async operations in progress.
- Avoid "click" - use "select" or "choose" for inclusivity with touch and keyboard.

## Microcopy
- Button labels: 1-3 words, imperative verb. ("Save", "Delete account", "Continue to payment")
- Placeholder text: Describe the expected format, not the field name. ("YYYY-MM-DD" not "Date")
- Tooltips: One sentence max. No punctuation unless multiple sentences.
`;

const GUIDELINE_MOTION = `# Motion and Animation Guidelines

## Principles
- Motion should communicate state changes and relationships, not decorate.
- Prefer subtle motion. If animation draws attention away from content, it is too much.
- Respect the prefers-reduced-motion media query - all animations must degrade gracefully.
- Use the motion token scale for all durations and easing values.

## Duration Scale
| Name | Token | Value | Use For |
|------|-------|-------|---------|
| instant | motion.duration.instant | 0ms | State changes with no perceivable transition |
| fast | motion.duration.fast | 100ms | Micro-interactions: hover states, focus rings |
| normal | motion.duration.normal | 200ms | Most UI transitions: modals, dropdowns, tooltips |
| slow | motion.duration.slow | 300ms | Page-level transitions, complex animations |
| deliberate | motion.duration.deliberate | 500ms | Loading screens, onboarding sequences |

## Easing Curves
| Name | Token | Use For |
|------|-------|---------|
| linear | motion.easing.linear | Progress bars, loading indicators |
| ease-in | motion.easing.easeIn | Exits: elements leaving the screen |
| ease-out | motion.easing.easeOut | Entrances: elements entering the screen |
| ease-in-out | motion.easing.easeInOut | Elements that move across the screen |
| spring | motion.easing.spring | Playful interactions: toggles, checkboxes |

## Common Transition Patterns
- Modal open: fade-in + scale-up (0.95 to 1.0), ease-out, 200ms
- Modal close: fade-out, ease-in, 150ms
- Dropdown expand: height + opacity, ease-out, 150ms
- Toast enter: slide-in from bottom + fade-in, ease-out, 200ms
- Toast exit: fade-out, ease-in, 150ms
- Button loading: spinner fade-in, ease-out, 100ms
`;

// ── MCP Server factory ────────────────────────────────────────────────────
// Returns a fully configured McpServer with all tools, resources, and prompts.
// Called once per HTTP request in stateless mode. Data is read from the shared
// dataStore on each call so that any JSON loaded via POST /api/data is
// immediately reflected in all MCP responses.
// ─────────────────────────────────────────────────────────────────────────
export function createMcpServer(): McpServer {
  const tokens       = getData("tokens")       as TokensData;
  const components   = getData("components")   as ComponentsData;
  const themes       = getData("themes")       as ThemesData;
  const icons        = getData("icons")        as IconsData;
  const changelog    = getData("changelog")    as ChangelogEntry[];
  const deprecations = getData("deprecations") as DeprecationEntry[];
  const styleGuide   = getData("style-guide")  as StyleGuideData;

  const server = new McpServer({
    name: "design-system-mcp",
    version: "0.3.0",
  });

  // ── Logging helper ─────────────────────────────────────────────────────
  function log(
    level: "debug" | "info" | "warning" | "error",
    event: string,
    data: Record<string, unknown>
  ): void {
    server.server.sendLoggingMessage({
      level,
      logger: "design-system-mcp",
      data: { event, ...data },
    }).catch(() => { /* ignore if transport not connected */ });
  }

  // =======================================================================
  // TOOLS — v0.1.0 (13 original tools)
  // =======================================================================

  // ── TOOL: list_token_categories ─────────────────────────────────────────
  server.tool(
    "list_token_categories",
    "List all top-level token categories available in the design system (e.g. color, typography, spacing, borderRadius, shadow). Use this first to discover what token data is available before calling get_tokens.",
    {},
    async (_args, _extra) => {
      const start = Date.now();
      const categories = Object.keys(tokens);
      log("info", "tool.invoked", { tool: "list_token_categories", params: {}, duration_ms: Date.now() - start, result_size: categories.length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ categories }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_tokens ────────────────────────────────────────────────────
  server.tool(
    "get_tokens",
    "Get design tokens by category (color, typography, spacing, borderRadius, shadow). Returns the full nested token tree for that category. Omit category to get all tokens at once.",
    {
      category: z
        .enum(["color", "typography", "spacing", "borderRadius", "shadow", "motion", "layout"])
        .optional()
        .describe("Optional token category. If omitted, all tokens are returned. Example: \"color\""),
    },
    async ({ category }, _extra) => {
      const start = Date.now();
      if (category && !(category in tokens)) {
        log("error", "tool.error", { tool: "get_tokens", params: { category }, error_code: "NOT_FOUND", error_message: `Category "${category}" not found` });
        return {
          content: [{ type: "text" as const, text: `Category "${category}" not found. Available: ${Object.keys(tokens).join(", ")}` }],
          isError: true,
        };
      }
      const data = category ? tokens[category] : tokens;
      log("info", "tool.invoked", { tool: "get_tokens", params: { category }, duration_ms: Date.now() - start, result_size: Object.keys(data).length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── TOOL: get_token ─────────────────────────────────────────────────────
  server.tool(
    "get_token",
    "Get a single token by its dot-notation path. Examples: \"color.primary.600\", \"spacing.4\", \"typography.fontFamily.sans\", \"color.semantic.text.primary\". Returns the token entry including value, type, and description if available.",
    {
      tokenPath: z.string().min(1).describe("Dot-notation path to the token. Example: \"color.primary.600\""),
    },
    async ({ tokenPath }, _extra) => {
      const start = Date.now();
      const value = getByPath(tokens as unknown as Record<string, unknown>, tokenPath);
      if (value === undefined) {
        log("error", "tool.error", { tool: "get_token", params: { tokenPath }, error_code: "NOT_FOUND", error_message: `Token "${tokenPath}" not found` });
        return {
          content: [{ type: "text" as const, text: `Token "${tokenPath}" not found. Use list_token_categories and get_tokens to explore the available tokens.` }],
          isError: true,
        };
      }
      log("info", "tool.invoked", { tool: "get_token", params: { tokenPath }, duration_ms: Date.now() - start, result_size: 1 });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ path: tokenPath, token: value }, null, 2) }],
      };
    }
  );

  // ── TOOL: list_components ───────────────────────────────────────────────
  server.tool(
    "list_components",
    "List all components in the design system with their names, descriptions, available variants, and sizes. Use this to discover what components are available before calling get_component.",
    {},
    async (_args, _extra) => {
      const start = Date.now();
      const summary = Object.entries(components).map(([key, spec]) => ({
        key,
        name:        spec.name,
        description: spec.description,
        variants:    spec.variants ?? [],
        sizes:       spec.sizes ?? [],
      }));
      log("info", "tool.invoked", { tool: "list_components", params: {}, duration_ms: Date.now() - start, result_size: summary.length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ components: summary }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_component ─────────────────────────────────────────────────
  server.tool(
    "get_component",
    "Get the complete specification for a design system component. Returns props, variants, sizes, token references, usage constraints, and accessibility requirements. Example componentName values: \"button\", \"input\", \"card\", \"badge\".",
    {
      componentName: z.string().min(1).describe("The component key or name (case-insensitive). Examples: \"button\", \"input\", \"card\", \"badge\"."),
    },
    async ({ componentName }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        log("error", "tool.error", { tool: "get_component", params: { componentName }, error_code: "NOT_FOUND", error_message: `Component "${componentName}" not found` });
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available components: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }
      const dep = deprecations.find(d => d.type === "component" && d.name.toLowerCase() === key);
      if (dep) {
        log("warning", "deprecation.accessed", { entity_type: "component", entity_name: dep.name, deprecated_since: dep.deprecatedSince, removal_version: dep.removalVersion, migration_path: dep.migrationPath });
      }
      log("info", "tool.invoked", { tool: "get_component", params: { componentName }, duration_ms: Date.now() - start, result_size: 1 });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(spec, null, 2) }],
      };
    }
  );

  // ── TOOL: get_component_tokens ──────────────────────────────────────────
  server.tool(
    "get_component_tokens",
    "Get all design token references used by a specific component. Returns a deduplicated, sorted list of token paths the component depends on, plus the raw token definitions for context. Example: \"button\" returns all color, spacing, and typography tokens it references.",
    {
      componentName: z.string().min(1).describe("The component key (e.g. \"button\", \"input\", \"card\")."),
    },
    async ({ componentName }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }
      const tokenRefs = new Set<string>();
      extractTokenRefs(spec.tokens, tokenRefs);
      log("info", "tool.invoked", { tool: "get_component_tokens", params: { componentName }, duration_ms: Date.now() - start, result_size: tokenRefs.size });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ component: spec.name, tokenReferences: Array.from(tokenRefs).sort(), rawTokenDefinitions: spec.tokens }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: validate_color ─────────────────────────────────────────────────
  server.tool(
    "validate_color",
    "Check whether a CSS color value (like \"#2563eb\" or \"rgb(37,99,235)\") maps to a named token in the design system. Returns the matching token paths if it is a recognized token value, or flags it as an arbitrary (non-compliant) color if not found.",
    {
      colorValue: z.string().min(1).describe("A CSS color value to look up. Examples: \"#2563eb\", \"#ffffff\", \"rgb(37, 99, 235)\"."),
    },
    async ({ colorValue }, _extra) => {
      const start = Date.now();
      const normalized = colorValue.trim().toLowerCase();
      const colorFlat  = flattenTokenValues(tokens.color as unknown as Record<string, unknown>, "color");
      const matches    = Object.entries(colorFlat)
        .filter(([, val]) => val.toLowerCase() === normalized)
        .map(([path, val]) => ({ tokenPath: path, value: val }));
      log("info", "tool.invoked", { tool: "validate_color", params: { colorValue }, duration_ms: Date.now() - start, result_size: matches.length });
      if (matches.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ input: colorValue, compliant: true, matchingTokens: matches, message: "This color value is a recognized design token. Use the token path instead of the raw value in production code." }, null, 2),
          }],
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ input: colorValue, compliant: false, matchingTokens: [], message: "This color is not part of the design token system. Replace it with a named token (e.g. color.primary.600) to stay compliant with system standards." }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: get_component_constraints ────────────────────────────────────
  server.tool(
    "get_component_constraints",
    "Get the usage constraints and accessibility requirements for a design system component. These are the enforceable rules the system defines for correct component usage. Example: \"button\" returns rules about variant usage, loading states, touch targets, and ARIA attributes.",
    {
      componentName: z.string().min(1).describe("The component key (e.g. \"button\", \"input\", \"card\", \"badge\")."),
    },
    async ({ componentName }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }
      log("info", "tool.invoked", { tool: "get_component_constraints", params: { componentName }, duration_ms: Date.now() - start, result_size: (spec.constraints ?? []).length });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ component: spec.name, constraints: spec.constraints ?? [], accessibility: spec.accessibility ?? {} }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: validate_component_usage ────────────────────────────────────
  server.tool(
    "validate_component_usage",
    "Validate whether a component configuration is valid according to the design system rules. Pass the component name and a props/config object to check. Returns a list of violations (if any), actionable fix suggestions, and a pass/fail result.",
    {
      componentName: z.string().min(1).describe("Component key, e.g. \"button\", \"input\"."),
      config: z.record(z.unknown()).describe("Props/config object to validate, e.g. { variant: \"primary\", size: \"xl\" }."),
    },
    async ({ componentName, config }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }

      const violations: Array<{ rule: string; suggestion: string }> = [];

      if (config.variant !== undefined && spec.variants) {
        if (!spec.variants.includes(String(config.variant))) {
          const variantHint = spec.variantGuidance
            ? Object.entries(spec.variantGuidance).map(([v, g]) => `"${v}": ${g.split(".")[0]}`).join("; ")
            : "";
          violations.push({
            rule: `Variant "${config.variant}" is not valid for ${spec.name}. Allowed variants: ${spec.variants.join(", ")}.`,
            suggestion: `Change variant to one of: ${spec.variants.join(", ")}.${variantHint ? ` Guidance: ${variantHint}.` : ""}`,
          });
        }
      }

      if (config.size !== undefined && spec.sizes) {
        if (!spec.sizes.includes(String(config.size))) {
          violations.push({
            rule: `Size "${config.size}" is not valid for ${spec.name}. Allowed sizes: ${spec.sizes.join(", ")}.`,
            suggestion: `Change size to one of: ${spec.sizes.join(", ")}.`,
          });
        }
      }

      if (config.state !== undefined && spec.states) {
        if (!spec.states.includes(String(config.state))) {
          violations.push({
            rule: `State "${config.state}" is not valid for ${spec.name}. Allowed states: ${spec.states.join(", ")}.`,
            suggestion: `Change state to one of: ${spec.states.join(", ")}.`,
          });
        }
      }

      if (spec.props) {
        const reservedKeys = new Set(["variant", "size", "state"]);
        for (const propKey of Object.keys(config)) {
          if (!reservedKeys.has(propKey) && !(propKey in spec.props)) {
            violations.push({
              rule: `Unknown prop "${propKey}" - not defined in the ${spec.name} spec.`,
              suggestion: `Remove "${propKey}" or replace with a valid prop. Valid props: ${Object.keys(spec.props).join(", ")}.`,
            });
          }
        }
      }

      if (violations.length > 0) {
        log("warning", "validation.failure", {
          tool: "validate_component_usage",
          component: spec.name,
          violation_count: violations.length,
          violations: violations.map(v => v.rule),
        });
      }
      log("info", "tool.invoked", { tool: "validate_component_usage", params: { componentName }, duration_ms: Date.now() - start, result_size: violations.length });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ component: spec.name, valid: violations.length === 0, violations, checkedProps: Object.keys(config) }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: suggest_token ─────────────────────────────────────────────────
  server.tool(
    "suggest_token",
    "Suggest the most appropriate design token for a described intent (e.g. 'primary button background', 'error text color', 'small spacing between icon and label'). Returns a ranked list of matching tokens with their values and paths.",
    {
      intent: z.string().min(1).describe("Natural-language description of what the token should be used for."),
      category: z
        .enum(["color", "typography", "spacing", "borderRadius", "shadow", "motion", "layout"])
        .optional()
        .describe("Optionally restrict the search to a single token category."),
    },
    async ({ intent, category }, _extra) => {
      const start = Date.now();
      const intentLower = intent.toLowerCase();
      const intentWords = intentLower.split(/[\s\-_./]+/).filter(Boolean);
      const source: Record<string, unknown> = category
        ? { [category]: tokens[category] }
        : (tokens as unknown as Record<string, unknown>);
      const flat = flattenAllTokens(source as Record<string, unknown>);
      const scored = Object.entries(flat).map(([tokenPath, meta]) => {
        const segments = tokenPath.toLowerCase().split(".");
        let score = 0;
        for (const word of intentWords) {
          for (const seg of segments) {
            if (seg.includes(word) || word.includes(seg)) score += 2;
          }
          if (meta.description) {
            const descWords = meta.description.toLowerCase().split(/\W+/);
            for (const dw of descWords) {
              if (dw && (dw.includes(word) || word.includes(dw))) score += 3;
            }
          }
        }
        return { tokenPath, value: meta.value, type: meta.type, description: meta.description ?? null, score };
      });
      const top5 = scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      log("info", "tool.invoked", { tool: "suggest_token", params: { intent, category }, duration_ms: Date.now() - start, result_size: top5.length });
      if (top5.length === 0) {
        log("warning", "search.no_results", { query: intent, suggestions: [] });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ intent, results: [], message: "No tokens matched the given intent. Try different keywords or omit the category filter." }, null, 2),
          }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ intent, results: top5 }, null, 2) }],
      };
    }
  );

  // ── TOOL: diff_against_system ───────────────────────────────────────────
  server.tool(
    "diff_against_system",
    "Compare a set of CSS properties or component props against the design system definitions. Flags values that don't match any token, and suggests the correct token to use instead. Useful for auditing generated or hand-written UI code.",
    {
      properties: z.record(z.string()).describe("Map of CSS property names to values, e.g. { \"background-color\": \"#2563eb\", \"font-size\": \"14px\" }."),
    },
    async ({ properties }, _extra) => {
      const start = Date.now();
      const allFlat = flattenAllTokens(tokens as unknown as Record<string, unknown>);
      const reverseMap: Record<string, string[]> = {};
      for (const [path, meta] of Object.entries(allFlat)) {
        const key = meta.value.toLowerCase();
        (reverseMap[key] ??= []).push(path);
      }
      const results = Object.entries(properties).map(([property, value]) => {
        const matches = reverseMap[value.toLowerCase()];
        if (matches && matches.length > 0) {
          return { property, value, status: "token-matched" as const, matchingTokens: matches };
        }
        return { property, value, status: "no-token-match" as const, suggestion: "Replace with a design token" };
      });
      const matched    = results.filter(r => r.status === "token-matched").length;
      const total      = results.length;
      const violations = total - matched;
      log("info", "tool.invoked", { tool: "diff_against_system", params: { property_count: total }, duration_ms: Date.now() - start, result_size: violations });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            compliant: violations === 0,
            summary: `${matched} of ${total} properties match design tokens. ${violations} violation${violations === 1 ? "" : "s"} found.`,
            results,
          }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: search ────────────────────────────────────────────────────────
  server.tool(
    "search",
    "Search across all design system tokens, components, and icons by keyword. Returns matching tokens, components, and icons ranked by relevance. Use this to discover the right token or component for a given term.",
    {
      query: z.string().min(1).describe("Search term, e.g. \"primary blue\" or \"modal overlay\"."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum number of results to return (default 10, max 50)."),
    },
    async ({ query, limit = 10 }, _extra) => {
      const start = Date.now();
      const queryWords = query.toLowerCase().split(/[\s\-_./,;:!?]+/).filter(Boolean);
      type SearchResult = { type: "token" | "component" | "icon"; key: string; score: number; preview: string };
      const results: SearchResult[] = [];

      const flat = flattenAllTokens(tokens as unknown as Record<string, unknown>);
      for (const [tokenPath, meta] of Object.entries(flat)) {
        const segments = tokenPath.toLowerCase().split(".");
        let score = 0;
        for (const word of queryWords) {
          for (const seg of segments) {
            if (seg.includes(word) || word.includes(seg)) score += 2;
          }
          if (meta.description) {
            for (const dw of meta.description.toLowerCase().split(/\W+/)) {
              if (dw && (dw.includes(word) || word.includes(dw))) score += 3;
            }
          }
        }
        if (score > 0) results.push({ type: "token", key: tokenPath, score, preview: meta.value });
      }

      const wordRegexes = queryWords.map(w => new RegExp(w, "g"));
      for (const [compKey, spec] of Object.entries(components)) {
        const haystack = [spec.name, spec.description, ...(spec.variants ?? []), ...Object.keys(spec.props ?? {}), ...(spec.constraints ?? [])].join(" ").toLowerCase();
        let score = 0;
        for (const re of wordRegexes) { re.lastIndex = 0; score += (haystack.match(re) ?? []).length * 2; }
        if (score > 0) results.push({ type: "component", key: compKey, score, preview: spec.description });
      }

      for (const [iconKey, icon] of Object.entries(icons)) {
        const haystack = [icon.name, icon.category, icon.description, ...icon.keywords].join(" ").toLowerCase();
        let score = 0;
        for (const re of wordRegexes) { re.lastIndex = 0; score += (haystack.match(re) ?? []).length * 2; }
        if (score > 0) results.push({ type: "icon", key: iconKey, score, preview: `${icon.category} icon — ${icon.description}` });
      }

      results.sort((a, b) => b.score - a.score);
      const sliced = results.slice(0, limit);
      log("info", "search.executed", { query, result_count: sliced.length, duration_ms: Date.now() - start });
      if (sliced.length === 0) log("warning", "search.no_results", { query, suggestions: [] });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, results: sliced }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_schema ────────────────────────────────────────────────────
  server.tool(
    "get_schema",
    "Return the JSON Schema for a design system data file. Use this before loading custom data (via POST /api/data) to understand the expected structure. Valid dataType values: \"tokens\", \"components\", \"themes\", \"icons\".",
    {
      dataType: z.enum(["tokens", "components", "themes", "icons"]).describe("The data file whose schema you want. One of: \"tokens\", \"components\", \"themes\", \"icons\"."),
    },
    async ({ dataType }, _extra) => {
      log("info", "tool.invoked", { tool: "get_schema", params: { dataType }, duration_ms: 0, result_size: 1 });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(DATA_SCHEMAS[dataType], null, 2) }],
      };
    }
  );

  // =======================================================================
  // TOOLS — v0.2.0 (13 new tools)
  // =======================================================================

  // ── TOOL: list_themes ─────────────────────────────────────────────────
  server.tool(
    "list_themes",
    "List all available themes in the design system (e.g. light, dark). Returns theme keys, names, and descriptions.",
    {},
    async (_args, _extra) => {
      const start = Date.now();
      const summary = Object.entries(themes).map(([key, spec]) => ({ key, name: spec.name, description: spec.description }));
      log("info", "tool.invoked", { tool: "list_themes", params: {}, duration_ms: Date.now() - start, result_size: summary.length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ themes: summary }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_theme ───────────────────────────────────────────────────
  server.tool(
    "get_theme",
    "Get full theme definition including all semantic token overrides and metadata. Example themeName values: \"light\", \"dark\".",
    {
      themeName: z.string().min(1).describe("The theme key (e.g. \"light\", \"dark\")."),
    },
    async ({ themeName }, _extra) => {
      const start = Date.now();
      const key  = themeName.toLowerCase().trim();
      const spec = themes[key];
      if (!spec) {
        log("error", "tool.error", { tool: "get_theme", params: { themeName }, error_code: "NOT_FOUND", error_message: `Theme "${themeName}" not found` });
        return {
          content: [{ type: "text" as const, text: `Theme "${themeName}" not found. Available: ${Object.keys(themes).join(", ")}` }],
          isError: true,
        };
      }
      log("info", "tool.invoked", { tool: "get_theme", params: { themeName }, duration_ms: Date.now() - start, result_size: Object.keys(spec.semantic ?? {}).length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ key, ...spec }, null, 2) }],
      };
    }
  );

  // ── TOOL: list_icons ──────────────────────────────────────────────────
  server.tool(
    "list_icons",
    "List all icons in the design system, optionally filtered by category or tag. Returns icon names, categories, keywords, and sizes.",
    {
      category: z.string().optional().describe("Optional category filter, e.g. \"navigation\", \"action\", \"status\"."),
      tag:      z.string().optional().describe("Optional keyword/tag filter to narrow results."),
    },
    async ({ category, tag }, _extra) => {
      const start = Date.now();
      let entries = Object.entries(icons);
      if (category) entries = entries.filter(([, icon]) => icon.category.toLowerCase() === category.toLowerCase());
      if (tag) {
        const tagLower = tag.toLowerCase();
        entries = entries.filter(([, icon]) =>
          icon.keywords.some(k => k.toLowerCase().includes(tagLower)) || icon.name.toLowerCase().includes(tagLower)
        );
      }
      const summary = entries.map(([key, icon]) => ({
        key, name: icon.name, category: icon.category, keywords: icon.keywords, sizes: icon.sizes, description: icon.description,
      }));
      log("info", "tool.invoked", { tool: "list_icons", params: { category, tag }, duration_ms: Date.now() - start, result_size: summary.length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ icons: summary, total: summary.length }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_icon ────────────────────────────────────────────────────
  server.tool(
    "get_icon",
    "Get a single icon by name. Returns metadata, available sizes, keywords, category, and usage guidance.",
    {
      iconName: z.string().min(1).describe("The icon key or name (e.g. \"arrow-right\", \"check\", \"alert-triangle\")."),
    },
    async ({ iconName }, _extra) => {
      const start = Date.now();
      const key  = iconName.toLowerCase().trim().replace(/\s+/g, "-");
      const icon = icons[key];
      if (!icon) {
        const sample = Object.keys(icons).slice(0, 10).join(", ");
        log("error", "tool.error", { tool: "get_icon", params: { iconName }, error_code: "NOT_FOUND", error_message: `Icon "${iconName}" not found` });
        return {
          content: [{ type: "text" as const, text: `Icon "${iconName}" not found. Sample icons: ${sample}. Use search_icons to find icons semantically.` }],
          isError: true,
        };
      }
      log("info", "tool.invoked", { tool: "get_icon", params: { iconName }, duration_ms: Date.now() - start, result_size: 1 });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ key, ...icon }, null, 2) }],
      };
    }
  );

  // ── TOOL: search_icons ────────────────────────────────────────────────
  server.tool(
    "search_icons",
    "Semantic search across the icon set. E.g. \"warning\" returns alert-triangle, exclamation-circle. Returns ranked results.",
    {
      query: z.string().min(1).describe("Natural-language search term, e.g. \"warning\", \"user profile\", \"close\"."),
      limit: z.number().int().min(1).max(20).optional().describe("Maximum results to return (default 5)."),
    },
    async ({ query, limit = 5 }, _extra) => {
      const start = Date.now();
      const queryWords = query.toLowerCase().split(/[\s\-_./,;:!?]+/).filter(Boolean);
      const scored = Object.entries(icons).map(([key, icon]) => {
        let score = 0;
        for (const word of queryWords) {
          if (icon.name.toLowerCase().includes(word)) score += 5;
          if (icon.keywords.some(k => k.toLowerCase().includes(word))) score += 3;
          const haystack = [icon.name, icon.category, icon.description, ...icon.keywords].join(" ").toLowerCase();
          if (haystack.includes(word)) score += 1;
        }
        return { key, name: icon.name, category: icon.category, keywords: icon.keywords, description: icon.description, score };
      });
      const results = scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
      log("info", "search.executed", { query, result_count: results.length, duration_ms: Date.now() - start });
      if (results.length === 0) log("warning", "search.no_results", { query, suggestions: ["Try broader terms like 'close', 'arrow', 'check'"] });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, results }, null, 2) }],
      };
    }
  );

  // ── TOOL: check_contrast ──────────────────────────────────────────────
  server.tool(
    "check_contrast",
    "Check the WCAG 2.1 contrast ratio between a foreground and background color. Returns AA and AAA pass/fail for normal text, large text, and UI components. Accepts hex color values.",
    {
      foreground: z.string().min(1).describe("Foreground (text) color as a hex value, e.g. \"#1e293b\"."),
      background: z.string().min(1).describe("Background color as a hex value, e.g. \"#ffffff\"."),
    },
    async ({ foreground, background }, _extra) => {
      const start = Date.now();
      const ratio = contrastRatio(foreground, background);
      if (ratio === null) {
        log("error", "tool.error", { tool: "check_contrast", params: { foreground, background }, error_code: "INVALID_COLOR", error_message: "Could not parse color values" });
        return {
          content: [{ type: "text" as const, text: `Could not parse colors "${foreground}" and/or "${background}". Provide hex values like "#2563eb" or "#ffffff".` }],
          isError: true,
        };
      }
      const r = Math.round(ratio * 100) / 100;
      const result = {
        foreground, background, ratio: r,
        normalText:   { aa: r >= 4.5, aaa: r >= 7.0 },
        largeText:    { aa: r >= 3.0, aaa: r >= 4.5 },
        uiComponents: { aa: r >= 3.0 },
        summary: r >= 7.0 ? "Passes WCAG AAA for all text sizes."
          : r >= 4.5 ? "Passes WCAG AA for normal text. Fails AAA for normal text."
          : r >= 3.0 ? "Passes WCAG AA for large text and UI components only. Fails AA for normal text."
          : "Fails all WCAG contrast requirements.",
      };
      log("info", "contrast.check", { foreground, background, ratio: r, aa_pass: result.normalText.aa, aaa_pass: result.normalText.aaa });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── TOOL: get_accessibility_guidance ─────────────────────────────────
  server.tool(
    "get_accessibility_guidance",
    "Get per-component accessibility specification: ARIA roles, keyboard interaction model, focus order, and screen reader expectations.",
    {
      componentName: z.string().min(1).describe("Component key (e.g. \"button\", \"modal\", \"input\")."),
    },
    async ({ componentName }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }
      const a11yConstraints = (spec.constraints ?? []).filter(c =>
        c.toLowerCase().includes("aria") || c.toLowerCase().includes("keyboard") ||
        c.toLowerCase().includes("focus") || c.toLowerCase().includes("wcag") ||
        c.toLowerCase().includes("screen reader") || c.toLowerCase().includes("touch") ||
        c.toLowerCase().includes("accessible")
      );
      log("info", "tool.invoked", { tool: "get_accessibility_guidance", params: { componentName }, duration_ms: Date.now() - start, result_size: 1 });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ component: spec.name, accessibility: spec.accessibility ?? {}, accessibilityConstraints: a11yConstraints }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: get_component_variants ──────────────────────────────────────
  server.tool(
    "get_component_variants",
    "List all variants for a component with when-to-use guidance and contextual rules for each variant.",
    {
      componentName: z.string().min(1).describe("Component key (e.g. \"button\", \"badge\", \"card\")."),
    },
    async ({ componentName }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }
      const variants = (spec.variants ?? []).map(v => ({
        variant:  v,
        guidance: spec.variantGuidance?.[v] ?? `No specific guidance defined for variant "${v}".`,
      }));
      log("info", "tool.invoked", { tool: "get_component_variants", params: { componentName }, duration_ms: Date.now() - start, result_size: variants.length });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ component: spec.name, variants, sizes: spec.sizes ?? [], states: spec.states ?? [] }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: get_component_anatomy ───────────────────────────────────────
  server.tool(
    "get_component_anatomy",
    "Get the internal structure of a component: named slots, valid children, composition patterns, and DOM root element.",
    {
      componentName: z.string().min(1).describe("Component key (e.g. \"button\", \"modal\", \"form\")."),
    },
    async ({ componentName }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }
      log("info", "tool.invoked", { tool: "get_component_anatomy", params: { componentName }, duration_ms: Date.now() - start, result_size: 1 });
      if (!spec.anatomy) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ component: spec.name, anatomy: null, message: "Anatomy not defined for this component." }, null, 2) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ component: spec.name, anatomy: spec.anatomy }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_component_relationships ────────────────────────────────
  server.tool(
    "get_component_relationships",
    "Get the relationships of a component: parent component, siblings, related components, and common composition contexts.",
    {
      componentName: z.string().min(1).describe("Component key (e.g. \"input\", \"button\", \"form\")."),
    },
    async ({ componentName }, _extra) => {
      const start = Date.now();
      const key  = componentName.toLowerCase().trim();
      const spec = components[key];
      if (!spec) {
        return {
          content: [{ type: "text" as const, text: `Component "${componentName}" not found. Available: ${Object.keys(components).join(", ")}` }],
          isError: true,
        };
      }
      const relationships = spec.relationships
        ?? (spec.relatedComponents ? { parent: null, siblings: [], related: spec.relatedComponents, children: [], composedIn: [] } : null);
      log("info", "tool.invoked", { tool: "get_component_relationships", params: { componentName }, duration_ms: Date.now() - start, result_size: 1 });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ component: spec.name, relationships }, null, 2),
        }],
      };
    }
  );

  // ── TOOL: get_layout_guidance ─────────────────────────────────────────
  server.tool(
    "get_layout_guidance",
    "Get contextual layout rules: page gutters, content max-widths, breakpoints, grid columns, and region spacing.",
    {
      context: z.string().optional().describe("Optional layout context, e.g. \"page\", \"form\", \"dashboard\", \"modal\"."),
    },
    async ({ context }, _extra) => {
      const start = Date.now();
      const layoutTokens = tokens.layout as Record<string, unknown>;
      const guidance = {
        breakpoints: layoutTokens.breakpoints ?? {},
        containerMaxWidth: layoutTokens.containerMaxWidth ?? {},
        grid: layoutTokens.grid ?? {},
        zIndex: layoutTokens.zIndex ?? {},
        guidelines: {
          pageGutters: { mobile: "16px (spacing.4)", tablet: "24px (spacing.6)", desktop: "32px (spacing.8)" },
          contentMaxWidths: { prose: "72ch (~680px)", form: "640px", fullWidth: "layout.containerMaxWidth token (1280px default)", dashboard: "1440px" },
          regionSpacing: { betweenPageSections: "spacing.16 (64px)", betweenCardGroups: "spacing.8 (32px)", betweenFormFields: "spacing.4 (16px)", betweenInlineItems: "spacing.2 (8px)" },
          ...(context ? { context } : {}),
        },
      };
      log("info", "tool.invoked", { tool: "get_layout_guidance", params: { context }, duration_ms: Date.now() - start, result_size: 1 });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(guidance, null, 2) }],
      };
    }
  );

  // ── TOOL: get_spacing_scale ───────────────────────────────────────────
  server.tool(
    "get_spacing_scale",
    "Get the complete spacing scale with semantic usage hints for each step (e.g. 'between label and input: spacing.2').",
    {},
    async (_args, _extra) => {
      const start = Date.now();
      const spacingTokens = tokens.spacing as Record<string, TokenEntry>;
      const semanticHints: Record<string, string> = {
        "0":  "No spacing; for elements that touch.",
        "1":  "4px - icon-to-text gap, tight inline spacing.",
        "2":  "8px - between label and input, between icon and label.",
        "3":  "12px - compact padding inside small components (badge, chip).",
        "4":  "16px - standard component padding, between form fields.",
        "5":  "20px - generous intra-component padding.",
        "6":  "24px - between related groups of components.",
        "8":  "32px - between card components, section sub-headers.",
        "10": "40px - between major content groups.",
        "12": "48px - between page sections (small).",
        "16": "64px - between major page sections.",
        "20": "80px - hero sections, large visual separators.",
        "24": "96px - very large page-level spacing.",
      };
      const scale = Object.entries(spacingTokens).map(([key, entry]) => ({
        token: `spacing.${key}`,
        value: entry.$value,
        type:  entry.$type,
        usage: semanticHints[key] ?? `spacing.${key} - ${entry.$value}`,
      }));
      log("info", "tool.invoked", { tool: "get_spacing_scale", params: {}, duration_ms: Date.now() - start, result_size: scale.length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ spacingScale: scale }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_changelog ───────────────────────────────────────────────
  server.tool(
    "get_changelog",
    "Get the design system version history. Filter by version range to see what changed between releases.",
    {
      fromVersion: z.string().optional().describe("Minimum version (inclusive), e.g. \"0.2.0\"."),
      toVersion:   z.string().optional().describe("Maximum version (inclusive), e.g. \"0.3.0\"."),
    },
    async ({ fromVersion, toVersion }, _extra) => {
      const start = Date.now();
      const parseVer = (v: string) => v.split(".").map(Number);
      const cmp = (a: string, b: string) => {
        const pa = parseVer(a), pb = parseVer(b);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
        }
        return 0;
      };
      const entries = changelog.filter(e => {
        if (fromVersion && cmp(e.version, fromVersion) < 0) return false;
        if (toVersion   && cmp(e.version, toVersion)   > 0) return false;
        return true;
      });
      log("info", "tool.invoked", { tool: "get_changelog", params: { fromVersion, toVersion }, duration_ms: Date.now() - start, result_size: entries.length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ changelog: entries }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_deprecations ────────────────────────────────────────────
  server.tool(
    "get_deprecations",
    "List all currently deprecated tokens, components, patterns, and endpoints with migration paths and removal timelines.",
    {
      type: z.enum(["token", "component", "endpoint", "all"]).optional().describe("Filter by deprecation type. Omit or use \"all\" for everything."),
    },
    async ({ type = "all" }, _extra) => {
      const start = Date.now();
      const filtered = type === "all" ? deprecations : deprecations.filter(d => d.type === type);
      log("info", "tool.invoked", { tool: "get_deprecations", params: { type }, duration_ms: Date.now() - start, result_size: filtered.length });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ deprecations: filtered, total: filtered.length }, null, 2) }],
      };
    }
  );

  // ── TOOL: get_style_guide ─────────────────────────────────────────────
  server.tool(
    "get_style_guide",
    "Retrieve design style guide content: principles, color usage rules, typography usage guidance, and composition patterns. Use 'section' to narrow the response.",
    {
      section: z.enum(["principles", "colorUsage", "typographyUsage", "compositionPatterns", "all"])
        .optional()
        .describe("Section to retrieve. Omit or use \"all\" for the complete style guide."),
    },
    async ({ section = "all" }, _extra) => {
      const start = Date.now();
      const result = section === "all" ? styleGuide : { [section]: styleGuide[section as keyof StyleGuideData] };
      log("info", "tool.invoked", { tool: "get_style_guide", params: { section }, duration_ms: Date.now() - start });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // =======================================================================
  // RESOURCES — v0.3.0
  // Read-only reference documents that agents can pull into context.
  // =======================================================================

  server.resource(
    "all-tokens",
    "design-system://tokens",
    { description: "Complete token reference - all categories, all values.", mimeType: "application/json" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getData("tokens"), null, 2) }] };
    }
  );

  server.resource(
    "all-components",
    "design-system://components",
    { description: "Full component index with summary metadata.", mimeType: "application/json" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      const summary = Object.entries(components).map(([key, spec]) => ({
        key, name: spec.name, description: spec.description, variants: spec.variants ?? [], sizes: spec.sizes ?? [],
      }));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ components: summary }, null, 2) }] };
    }
  );

  server.resource(
    "all-themes",
    "design-system://themes",
    { description: "List of all available themes with summary metadata.", mimeType: "application/json" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      const summary = Object.entries(themes).map(([key, spec]) => ({ key, name: spec.name, description: spec.description }));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ themes: summary }, null, 2) }] };
    }
  );

  server.resource(
    "all-icons",
    "design-system://icons",
    { description: "Full icon catalog with names, categories, tags, and metadata.", mimeType: "application/json" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getData("icons"), null, 2) }] };
    }
  );

  server.resource(
    "changelog-full",
    "design-system://changelog",
    { description: "Full version history.", mimeType: "text/markdown" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      const md = changelog.map(e =>
        `## v${e.version} - ${e.date}\n${e.summary}` +
        (e.added.length     ? `\n\n**Added:**\n${e.added.map(a => `- ${a}`).join("\n")}`       : "") +
        (e.changed.length   ? `\n\n**Changed:**\n${e.changed.map(c => `- ${c}`).join("\n")}`   : "") +
        (e.deprecated.length? `\n\n**Deprecated:**\n${e.deprecated.map(d => `- ${d}`).join("\n")}` : "") +
        (e.removed.length   ? `\n\n**Removed:**\n${e.removed.map(r => `- ${r}`).join("\n")}`   : "")
      ).join("\n\n---\n\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: `# Design System Changelog\n\n${md}` }] };
    }
  );

  server.resource(
    "changelog-latest",
    "design-system://changelog/latest",
    { description: "Most recent changelog entry.", mimeType: "text/markdown" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      const latest = changelog[0];
      if (!latest) return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: "No changelog entries found." }] };
      const md = `## v${latest.version} - ${latest.date}\n${latest.summary}` +
        (latest.added.length     ? `\n\n**Added:**\n${latest.added.map(a => `- ${a}`).join("\n")}`        : "") +
        (latest.changed.length   ? `\n\n**Changed:**\n${latest.changed.map(c => `- ${c}`).join("\n")}`    : "") +
        (latest.deprecated.length? `\n\n**Deprecated:**\n${latest.deprecated.map(d => `- ${d}`).join("\n")}` : "");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: md }] };
    }
  );

  server.resource(
    "all-deprecations",
    "design-system://deprecations",
    { description: "All current deprecations with migration paths and removal timelines.", mimeType: "application/json" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getData("deprecations"), null, 2) }] };
    }
  );

  server.resource(
    "style-guide",
    "design-system://style-guide",
    { description: "Design style guide: principles, color usage, typography usage, and composition patterns.", mimeType: "application/json" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getData("style-guide"), null, 2) }] };
    }
  );

  server.resource(
    "guidelines-accessibility",
    "design-system://guidelines/accessibility",
    { description: "Full accessibility guidelines - global rules, testing expectations, tooling.", mimeType: "text/markdown" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDELINE_ACCESSIBILITY }] };
    }
  );

  server.resource(
    "guidelines-layout",
    "design-system://guidelines/layout",
    { description: "Layout principles - grid system, breakpoints, responsive behavior, spacing philosophy.", mimeType: "text/markdown" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDELINE_LAYOUT }] };
    }
  );

  server.resource(
    "guidelines-content",
    "design-system://guidelines/content",
    { description: "Content guidelines - voice and tone, writing conventions, terminology.", mimeType: "text/markdown" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDELINE_CONTENT }] };
    }
  );

  server.resource(
    "guidelines-motion",
    "design-system://guidelines/motion",
    { description: "Motion and animation principles - duration scales, easing curves, transition patterns.", mimeType: "text/markdown" },
    async (uri) => {
      log("info", "resource.accessed", { uri: uri.href });
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDELINE_MOTION }] };
    }
  );

  // ── Template Resources ─────────────────────────────────────────────────

  server.resource(
    "tokens-by-category",
    new ResourceTemplate("design-system://tokens/{category}", { list: undefined }),
    { description: "All tokens within a specific category (e.g. color, spacing, typography).", mimeType: "application/json" },
    async (uri, { category }) => {
      const cat = String(category);
      log("info", "resource.accessed", { uri: uri.href, category: cat });
      const catTokens = (tokens as unknown as Record<string, unknown>)[cat];
      if (!catTokens) {
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: `Category "${cat}" not found. Available: ${Object.keys(tokens).join(", ")}` }) }] };
      }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(catTokens, null, 2) }] };
    }
  );

  server.resource(
    "component-spec",
    new ResourceTemplate("design-system://components/{name}/spec", { list: undefined }),
    { description: "Complete spec sheet for a single component - props, variants, anatomy, constraints, accessibility.", mimeType: "application/json" },
    async (uri, { name }) => {
      const key = String(name).toLowerCase();
      log("info", "resource.accessed", { uri: uri.href, component: key });
      const spec = components[key];
      if (!spec) {
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: `Component "${name}" not found. Available: ${Object.keys(components).join(", ")}` }) }] };
      }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(spec, null, 2) }] };
    }
  );

  server.resource(
    "component-examples",
    new ResourceTemplate("design-system://components/{name}/examples", { list: undefined }),
    { description: "Curated usage examples for a component, suitable for few-shot prompting.", mimeType: "text/markdown" },
    async (uri, { name }) => {
      const key = String(name).toLowerCase();
      log("info", "resource.accessed", { uri: uri.href, component: key });
      const spec = components[key];
      if (!spec) return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: `Component "${name}" not found.` }] };
      const examples = `# ${spec.name} Usage Examples\n\n` +
        `## Basic Usage\n\`\`\`jsx\n<${spec.name} />\n\`\`\`\n\n` +
        (spec.variants?.length ? `## Variants\n${spec.variants.map(v => `### ${v}\n\`\`\`jsx\n<${spec.name} variant="${v}" />\n\`\`\``).join("\n\n")}\n\n` : "") +
        (spec.sizes?.length    ? `## Sizes\n${spec.sizes.map(s => `### ${s}\n\`\`\`jsx\n<${spec.name} size="${s}" />\n\`\`\``).join("\n\n")}\n\n` : "") +
        `## Constraints\n${(spec.constraints ?? []).map(c => `- ${c}`).join("\n")}`;
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: examples }] };
    }
  );

  server.resource(
    "theme-by-name",
    new ResourceTemplate("design-system://themes/{name}", { list: undefined }),
    { description: "Full theme definition - all token overrides and configuration.", mimeType: "application/json" },
    async (uri, { name }) => {
      const key = String(name).toLowerCase();
      log("info", "resource.accessed", { uri: uri.href, theme: key });
      const theme = themes[key];
      if (!theme) {
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: `Theme "${name}" not found. Available: ${Object.keys(themes).join(", ")}` }) }] };
      }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ key, ...theme }, null, 2) }] };
    }
  );

  // =======================================================================
  // PROMPTS — v0.3.0
  // Reusable, parameterized templates that structure LLM interaction.
  // =======================================================================

  // ── Build & Create ─────────────────────────────────────────────────────

  server.prompt(
    "design-system/build-component",
    "Guide an LLM through building a component that conforms to the design system - correct tokens, props, constraints, and accessibility.",
    {
      component_name: z.string().describe("The component to build (e.g. 'button', 'input')."),
      variant:   z.string().optional().describe("Specific variant to build."),
      theme:     z.string().optional().describe("Theme context (e.g. 'dark')."),
      framework: z.string().optional().describe("Target framework (e.g. 'React', 'Vue')."),
    },
    async ({ component_name, variant, theme, framework }) => {
      const spec = components[component_name.toLowerCase()];
      const specText = spec ? JSON.stringify(spec, null, 2) : `Component "${component_name}" not found in the design system.`;
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Build a ${component_name} component${variant ? ` (variant: ${variant})` : ""}${theme ? ` for the ${theme} theme` : ""}${framework ? ` using ${framework}` : ""}.\n\nDesign system spec:\n\`\`\`json\n${specText}\n\`\`\`\n\nRequirements:\n- Use only the token values defined in the spec\n- Respect all constraints listed\n- Implement all required accessibility attributes\n- Use the exact prop names and values defined in the spec\n- Include a brief usage example`,
          },
        }],
      };
    }
  );

  server.prompt(
    "design-system/compose-layout",
    "Guide an LLM through assembling a page layout using system components, correct spacing, and responsive rules.",
    {
      layout_type: z.string().describe("Type of layout (e.g. 'landing page', 'dashboard', 'settings form')."),
      components:  z.string().describe("Comma-separated list of components to include."),
      breakpoints: z.string().optional().describe("Target breakpoints (e.g. 'mobile, tablet, desktop')."),
    },
    async ({ layout_type, components: comps, breakpoints }) => {
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Compose a ${layout_type} layout using these components: ${comps}${breakpoints ? ` at breakpoints: ${breakpoints}` : ""}.\n\nLayout guidelines:\n${GUIDELINE_LAYOUT}\n\nRequirements:\n- Use the correct spacing tokens for inter-component and inter-section gaps\n- Apply correct breakpoints from the layout.breakpoints token set\n- Follow the grid column rules for the target breakpoints\n- Identify the component hierarchy and composition structure`,
          },
        }],
      };
    }
  );

  server.prompt(
    "design-system/implement-theme",
    "Guide an LLM through applying a theme using the correct token overrides.",
    {
      theme_name: z.string().describe("Theme to apply (e.g. 'dark', 'light')."),
      scope:      z.string().optional().describe("Scope to apply the theme to (e.g. 'full page', 'card component')."),
    },
    async ({ theme_name, scope }) => {
      const theme = themes[theme_name.toLowerCase()];
      const themeText = theme ? JSON.stringify(theme, null, 2) : `Theme "${theme_name}" not found.`;
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Implement the ${theme_name} theme${scope ? ` for: ${scope}` : ""}.\n\nTheme definition:\n\`\`\`json\n${themeText}\n\`\`\`\n\nRequirements:\n- Apply all semantic token overrides from the theme definition\n- Show how each component token reference resolves under this theme\n- Provide implementation guidance (CSS custom properties, context provider, etc.)`,
          },
        }],
      };
    }
  );

  // ── Review & Validate ──────────────────────────────────────────────────

  server.prompt(
    "design-system/review-markup",
    "Review markup or component code against the design system - checks token usage, constraints, accessibility, and composition rules.",
    {
      code:   z.string().describe("The markup or component code to review."),
      strict: z.string().optional().describe("Set to \"true\" to treat warnings as errors."),
    },
    async ({ code, strict }) => {
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review this code against the design system${strict === "true" ? " (strict mode - treat all warnings as errors)" : ""}:\n\n\`\`\`\n${code}\n\`\`\`\n\nCheck for:\n1. Token compliance - are all color, spacing, and typography values from the design system token set?\n2. Component constraint violations - do component props match allowed variants, sizes, and states?\n3. Accessibility - correct ARIA roles, keyboard interaction, focus management, contrast?\n4. Composition correctness - are components composed as specified in their anatomy?\n5. Deprecated patterns - are any deprecated tokens, components, or patterns in use?\n\nFor each issue found, provide: location, violation description, and specific fix.`,
          },
        }],
      };
    }
  );

  server.prompt(
    "design-system/audit-page",
    "Perform a comprehensive design system audit on a full page - coverage, consistency, spacing, accessibility, and deprecated pattern detection.",
    {
      code:      z.string().describe("Full page markup or component tree to audit."),
      page_type: z.string().optional().describe("Type of page (e.g. 'marketing landing', 'admin dashboard', 'checkout')."),
    },
    async ({ code, page_type }) => {
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Perform a full design system audit on this ${page_type ?? "page"}:\n\n\`\`\`\n${code}\n\`\`\`\n\nAudit scope:\n1. Token coverage: What percentage of color, spacing, and typography values use design tokens?\n2. Consistency: Are there inconsistent usages of the same semantic concept?\n3. Spacing: Does spacing follow the scale? Any arbitrary values?\n4. Accessibility: Global a11y audit - landmarks, headings, color contrast, keyboard operability.\n5. Deprecated patterns: Any tokens, components, or patterns scheduled for removal?\n6. Component misuse: Components used outside their intended context or with invalid props?\n\nProvide an overall score, a summary of findings, and a prioritized list of fixes.`,
          },
        }],
      };
    }
  );

  // ── Migrate & Fix ──────────────────────────────────────────────────────

  server.prompt(
    "design-system/migrate-deprecated",
    "Identify all deprecated tokens, components, and patterns in code and produce migration suggestions.",
    {
      code:           z.string().describe("Code to scan for deprecated patterns."),
      target_version: z.string().optional().describe("Target version to migrate to (e.g. '0.3.0')."),
    },
    async ({ code, target_version }) => {
      const depList = deprecations.map(d =>
        `- **${d.name}** (${d.type}, deprecated in v${d.deprecatedSince}, removal in v${d.removalVersion}): ${d.migrationPath}`
      ).join("\n");
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Migrate deprecated patterns in this code${target_version ? ` to target version ${target_version}` : ""}:\n\n\`\`\`\n${code}\n\`\`\`\n\nCurrent deprecations:\n${depList}\n\nFor each deprecated pattern found:\n1. Identify its location in the code\n2. Explain why it is deprecated\n3. Show the migration path with updated code\n4. Flag any breaking changes that require manual attention`,
          },
        }],
      };
    }
  );

  server.prompt(
    "design-system/fix-violations",
    "Take validation output from validate_component_usage and produce corrected code with explanations.",
    {
      violations:    z.string().describe("JSON string of violations array from validate_component_usage."),
      original_code: z.string().optional().describe("Original code that produced the violations."),
    },
    async ({ violations, original_code }) => {
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Fix these design system violations:\n\n\`\`\`json\n${violations}\n\`\`\`\n${original_code ? `\nOriginal code:\n\`\`\`\n${original_code}\n\`\`\`` : ""}\n\nFor each violation:\n1. Explain the rule that was broken\n2. Show the corrected code snippet\n3. Explain why the fix is correct according to the design system spec`,
          },
        }],
      };
    }
  );

  // ── Explore & Learn ────────────────────────────────────────────────────

  server.prompt(
    "design-system/explain-component",
    "Produce a clear explanation of a component - what it is for, when to use it vs. alternatives, key variants, common pitfalls.",
    {
      component_name: z.string().describe("Component to explain (e.g. 'button', 'modal')."),
      audience: z.enum(["developer", "designer", "pm"]).optional().describe("Target audience for the explanation."),
    },
    async ({ component_name, audience }) => {
      const spec = components[component_name.toLowerCase()];
      const specText = spec ? JSON.stringify(spec, null, 2) : `Component "${component_name}" not found.`;
      const audienceNote = audience === "designer" ? "Focus on visual variants, spacing, and when to use this vs. similar components."
        : audience === "pm" ? "Focus on use cases, user scenarios, and high-level behavior - no code."
        : "Include implementation details, prop types, and code examples.";
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Explain the ${component_name} component to a ${audience ?? "developer"}. ${audienceNote}\n\nComponent spec:\n\`\`\`json\n${specText}\n\`\`\`\n\nCover:\n1. What it is and what it is used for\n2. When to use it vs. similar components\n3. Key variants and when to choose each\n4. Common pitfalls and how to avoid them\n5. ${audience === "developer" ? "Basic usage example" : "Visual or conceptual example"}`,
          },
        }],
      };
    }
  );

  server.prompt(
    "design-system/compare-components",
    "Explain the differences between two similar components and when to use each.",
    {
      component_a: z.string().describe("First component to compare (e.g. 'modal')."),
      component_b: z.string().describe("Second component to compare (e.g. 'toast')."),
    },
    async ({ component_a, component_b }) => {
      const specA = components[component_a.toLowerCase()];
      const specB = components[component_b.toLowerCase()];
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Compare the ${component_a} and ${component_b} components and explain when to use each.\n\n${component_a} spec:\n\`\`\`json\n${JSON.stringify(specA ?? { error: "not found" }, null, 2)}\n\`\`\`\n\n${component_b} spec:\n\`\`\`json\n${JSON.stringify(specB ?? { error: "not found" }, null, 2)}\n\`\`\`\n\nAddress:\n1. What each component is optimized for\n2. Key behavioral and visual differences\n3. Decision criteria for choosing one over the other\n4. Scenarios where each excels\n5. Can they be combined? When?`,
          },
        }],
      };
    }
  );

  server.prompt(
    "design-system/token-rationale",
    "Explain the reasoning behind a token value or scale - why this specific value, why this progression.",
    {
      token_name: z.string().describe("Token name or category to explain (e.g. 'color.primary.600', 'spacing')."),
    },
    async ({ token_name }) => {
      const value = getByPath(tokens as unknown as Record<string, unknown>, token_name);
      const tokenText = value !== undefined ? JSON.stringify({ path: token_name, token: value }, null, 2) : `Token "${token_name}" not found.`;
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Explain the design rationale for this token: ${token_name}\n\nToken data:\n\`\`\`json\n${tokenText}\n\`\`\`\n\nExplain:\n1. Why this specific value was chosen\n2. How it fits into the broader scale or system\n3. What design principle or constraint it encodes\n4. When and why to use this token vs. adjacent values`,
          },
        }],
      };
    }
  );

  return server;
}
