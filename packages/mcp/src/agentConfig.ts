/**
 * Design System MCP — Agent Configuration
 * Author: Thomas J McLeish
 * License: MIT
 *
 * Centralised config for all agents used by the /api/chat
 * endpoint.  Keeping this in its own file means:
 *   • routes/chat.ts and routes/agent.ts both import from one source of truth
 *   • adding or tweaking a tool definition does not require touching routing code
 *
 * Five agents:
 *   Orchestrator       — classifies intent, delegates to a specialist
 *   Design System Reader — read-only Q&A against tokens/components/themes/icons
 *   Component Builder  — generates grounded HTML/CSS component code
 *   System Generator   — gathers brand requirements and calls generate_design_system
 *   Style Guide        — explains design principles, color usage, typography, and composition patterns
 */

// ── OpenRouter tool definitions ───────────────────────────────────────────
// These mirror the MCP tools but are expressed in the OpenAI function-calling
// format that OpenRouter understands.
// ─────────────────────────────────────────────────────────────────────────
export const OPENROUTER_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_token_categories",
      description: "List all top-level token categories available in the design system (e.g. color, typography, spacing, borderRadius, shadow). Use this first to discover what token data is available before calling get_tokens.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tokens",
      description: "Get design tokens by category (color, typography, spacing, borderRadius, shadow, motion, layout). Returns the full nested token tree for that category. Omit category to get all tokens at once.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["color", "typography", "spacing", "borderRadius", "shadow", "motion", "layout"],
            description: "Optional token category. If omitted, all tokens are returned.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_token",
      description: 'Get a single token by its dot-notation path. Examples: "color.primary.600", "spacing.4", "typography.fontFamily.sans". Returns the token entry including value, type, and description if available.',
      parameters: {
        type: "object",
        properties: {
          tokenPath: { type: "string", description: 'Dot-notation path to the token. Example: "color.primary.600"' },
        },
        required: ["tokenPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_components",
      description: "List all components in the design system with their names, descriptions, available variants, and sizes.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_component",
      description: 'Get the complete specification for a design system component. Returns props, variants, sizes, token references, usage constraints, and accessibility requirements. Example componentName values: "button", "input", "card", "badge".',
      parameters: {
        type: "object",
        properties: {
          componentName: { type: "string", description: 'The component key or name (case-insensitive). Examples: "button", "input", "card", "badge".' },
        },
        required: ["componentName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_component_tokens",
      description: "Get all design token references used by a specific component. Returns a deduplicated, sorted list of token paths the component depends on.",
      parameters: {
        type: "object",
        properties: {
          componentName: { type: "string", description: 'The component key (e.g. "button", "input", "card").' },
        },
        required: ["componentName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_color",
      description: 'Check whether a CSS color value (like "#2563eb" or "rgb(37,99,235)") maps to a named token in the design system.',
      parameters: {
        type: "object",
        properties: {
          colorValue: { type: "string", description: 'A CSS color value to look up. Examples: "#2563eb", "#ffffff".' },
        },
        required: ["colorValue"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_component_constraints",
      description: "Get the usage constraints and accessibility requirements for a design system component.",
      parameters: {
        type: "object",
        properties: {
          componentName: { type: "string", description: 'The component key (e.g. "button", "input", "card", "badge").' },
        },
        required: ["componentName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_component_usage",
      description: "Validate whether a component configuration is valid according to the design system rules. Pass the component name and a props/config object to check.",
      parameters: {
        type: "object",
        properties: {
          componentName: { type: "string", description: 'Component key, e.g. "button", "input".' },
          config: {
            type: "object",
            description: 'Props/config object to validate, e.g. { "variant": "primary", "size": "xl" }.',
            additionalProperties: true,
          },
        },
        required: ["componentName", "config"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_token",
      description: "Suggest the most appropriate design token for a described intent (e.g. 'primary button background', 'error text color'). Returns a ranked list of matching tokens.",
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string", description: "Natural-language description of what the token should be used for." },
          category: {
            type: "string",
            enum: ["color", "typography", "spacing", "borderRadius", "shadow", "motion", "layout"],
            description: "Optionally restrict the search to a single token category.",
          },
        },
        required: ["intent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_against_system",
      description: "Compare a set of CSS properties or component props against the design system definitions. Flags values that don't match any token.",
      parameters: {
        type: "object",
        properties: {
          properties: {
            type: "object",
            description: 'Map of CSS property names to values, e.g. { "background-color": "#2563eb", "font-size": "14px" }.',
            additionalProperties: { type: "string" },
          },
        },
        required: ["properties"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description: "Search across all design system tokens, components, and icons by keyword. Returns matching results ranked by relevance.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: 'Search term, e.g. "primary blue" or "modal overlay".' },
          limit: { type: "number", description: "Maximum number of results to return (default 10, max 50)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_schema",
      description: 'Return the JSON Schema for a design system data file. Use this before loading custom data to understand the expected structure. Valid dataType values: "tokens", "components", "themes", "icons".',
      parameters: {
        type: "object",
        properties: {
          dataType: {
            type: "string",
            enum: ["tokens", "components", "themes", "icons"],
            description: "The data file to get the schema for.",
          },
        },
        required: ["dataType"],
      },
    },
  },
  // v0.2.0 tools
  { type: "function", function: { name: "list_themes", description: "List all available themes (e.g. light, dark). Returns theme keys, names, and descriptions.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_theme", description: 'Get full theme definition including all semantic token overrides. Example: "light", "dark".', parameters: { type: "object", properties: { themeName: { type: "string", description: "The theme key." } }, required: ["themeName"] } } },
  { type: "function", function: { name: "list_icons", description: "List all icons, optionally filtered by category or tag.", parameters: { type: "object", properties: { category: { type: "string", description: "Optional icon category to filter by, e.g. 'navigation', 'action'." }, tag: { type: "string", description: "Optional tag to filter by, e.g. 'arrow', 'alert'." } }, required: [] } } },
  { type: "function", function: { name: "get_icon", description: "Get a single icon by name with metadata, sizes, and usage guidance.", parameters: { type: "object", properties: { iconName: { type: "string", description: "The icon key, e.g. 'arrow-right'." } }, required: ["iconName"] } } },
  { type: "function", function: { name: "search_icons", description: "Semantic search across the icon set. E.g. 'warning' returns alert-triangle, exclamation-circle.", parameters: { type: "object", properties: { query: { type: "string", description: "Natural-language search term, e.g. 'warning', 'close', 'arrow right'." }, limit: { type: "number", description: "Maximum number of results to return (default 10)." } }, required: ["query"] } } },
  { type: "function", function: { name: "check_contrast", description: "Check WCAG 2.1 contrast ratio between foreground and background hex colors. Returns AA/AAA pass/fail.", parameters: { type: "object", properties: { foreground: { type: "string", description: "Foreground hex color, e.g. '#1e293b'." }, background: { type: "string", description: "Background hex color, e.g. '#ffffff'." } }, required: ["foreground", "background"] } } },
  { type: "function", function: { name: "get_accessibility_guidance", description: "Get per-component accessibility spec: ARIA roles, keyboard interaction, focus order, screen reader expectations.", parameters: { type: "object", properties: { componentName: { type: "string", description: "The component key, e.g. 'button', 'modal', 'input'." } }, required: ["componentName"] } } },
  { type: "function", function: { name: "get_component_variants", description: "List all variants for a component with when-to-use guidance for each.", parameters: { type: "object", properties: { componentName: { type: "string", description: "The component key, e.g. 'button', 'badge', 'alert'." } }, required: ["componentName"] } } },
  { type: "function", function: { name: "get_component_anatomy", description: "Get internal structure of a component: named slots, valid children, and composition patterns.", parameters: { type: "object", properties: { componentName: { type: "string", description: "The component key, e.g. 'card', 'modal', 'select'." } }, required: ["componentName"] } } },
  { type: "function", function: { name: "get_component_relationships", description: "Get component relationships: parent, siblings, related components, and composition contexts.", parameters: { type: "object", properties: { componentName: { type: "string", description: "The component key, e.g. 'button', 'input', 'card'." } }, required: ["componentName"] } } },
  { type: "function", function: { name: "get_layout_guidance", description: "Get layout rules: page gutters, content max-widths, breakpoints, grid columns, and region spacing.", parameters: { type: "object", properties: { context: { type: "string", description: "Optional context, e.g. 'page', 'form', 'dashboard'." } }, required: [] } } },
  { type: "function", function: { name: "get_spacing_scale", description: "Get the complete spacing scale with semantic usage hints for each step.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_changelog", description: "Get the design system version history, filterable by version range.", parameters: { type: "object", properties: { fromVersion: { type: "string", description: "Inclusive lower bound version, e.g. '0.2.0'." }, toVersion: { type: "string", description: "Inclusive upper bound version, e.g. '0.3.0'." } }, required: [] } } },
  { type: "function", function: { name: "get_deprecations", description: "List all deprecated tokens, components, patterns, and endpoints with migration paths.", parameters: { type: "object", properties: { type: { type: "string", enum: ["token", "component", "endpoint", "all"] } }, required: [] } } },
  { type: "function", function: { name: "get_style_guide", description: "Retrieve design style guide content: principles, color usage rules, typography usage, and composition patterns.", parameters: { type: "object", properties: { section: { type: "string", enum: ["principles", "colorUsage", "typographyUsage", "compositionPatterns", "all"] } }, required: [] } } },
  // AI generation
  {
    type: "function",
    function: {
      name: "generate_design_system",
      description:
        "Generate a complete design system (tokens, components, themes, icons) from a natural-language description and automatically load it for immediate use. " +
        "Call this once you have gathered sufficient information about the user's brand name, product type, aesthetic direction, primary colors, secondary colors, and typography preferences. " +
        "The generated design system replaces the currently loaded data and is immediately available in the Component Explorer.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "Comprehensive description including: brand name, product type, aesthetic direction " +
              "(e.g. modern/minimal, playful, professional, trustworthy, bold/expressive), primary color(s), " +
              "secondary color(s), typography style, and any other brand characteristics provided by the user.",
          },
        },
        required: ["description"],
      },
    },
  },
] as const;

// ── Unified (legacy) system prompt ───────────────────────────────────────
// Used as a safety net when Orchestrator routing fails.  Gives the model
// access to all tools and formats responses the same way the specialists do.
// ─────────────────────────────────────────────────────────────────────────
export const CHAT_SYSTEM_PROMPT =
  "You are a design system expert assistant. You have access to a design system MCP server with tokens, components, themes, icons, and guidelines. " +
  "When the user asks about UI components, colors, spacing, typography, design tokens, layout, accessibility, themes, icons, changelog, or deprecations, " +
  "call the appropriate tools to get accurate data from the design system before answering. " +
  "Use diff_against_system to check whether CSS properties or values match design system tokens. " +
  "Always use the actual token values and component specs from the tools — never guess or invent values.\n\n" +
  "## Response format\n" +
  "IMPORTANT: Every response must be a single valid JSON object. Output ONLY the JSON — no text, no markdown, no code fences outside it.\n\n" +
  "When answering a question (no UI to render):\n" +
  '{"schemaVersion":"1.0","message":"Your prose answer here.","metadata":{"intent":"answer"}}\n\n' +
  "When generating a UI component:\n" +
  '{"schemaVersion":"1.0","message":"Your prose explanation here.","preview":"<button style=\\"...\\">...</button>","metadata":{"intent":"render"}}\n\n' +
  "Field rules:\n" +
  '  • "schemaVersion": string version tag for response contract. Use "1.0". Required.\n' +
  '  • "message": plain prose text for the chat — no HTML, no code fences, no emojis. Required.\n' +
  '  • "preview": raw HTML markup only — no backtick fences, no extra wrappers. ' +
  "Use inline styles only. Apply exact token values from the MCP tools. " +
  "Omit this field entirely when no UI is generated.\n" +
  '  • "metadata": optional object with concise machine-friendly notes (for example: agent, intent, citedTools).\n\n' +
  "You also help users create brand-new design systems through conversation. " +
  "When a user wants to generate a design system:\n" +
  "1. Gather their brand name, product type, aesthetic direction (e.g. modern/minimal, playful, professional, trustworthy, bold), primary color(s), secondary color(s), and typography style preferences.\n" +
  "2. Ask clarifying questions one at a time until you have at least a clear brand aesthetic and color direction.\n" +
  "3. Once you have enough information (typically after 2–4 exchanges), call the generate_design_system tool with a comprehensive, detailed description.\n" +
  "4. After the tool returns success, briefly summarise what was generated and tell the user it has been loaded and is ready to explore.";

// ── Strategy 3: per-agent system prompts ────────────────────────────────
export const ORCHESTRATOR_SYSTEM_PROMPT =
  "You are a routing agent. Your only job is to classify the user's intent and call delegate_to_agent exactly once.\n\n" +
  'Route to "reader" for: questions, explanations, token lookups, component specs, icon search, theme info, changelog, deprecations, layout and accessibility guidance.\n' +
  'Route to "builder" for: requests to create, build, render, or code a UI component or HTML preview.\n' +
  'Route to "generator" for: requests to create a brand-new design system, extract styles from a website, or generate from scratch.\n' +
  'Route to "style-guide" for: questions about design principles, color usage rules, typography guidelines, composition patterns, or how to correctly apply the style guide.\n\n' +
  "Always call delegate_to_agent. Never answer the user directly.";

export const READER_SYSTEM_PROMPT =
  "You are a design system expert assistant. Answer questions about tokens, components, themes, icons, layout, and accessibility by calling the appropriate read-only tools. " +
  "Use diff_against_system to answer CSS compliance questions (e.g. 'does this color or spacing value match our design system tokens?'). " +
  "Use validate_color to check whether a hex value is a valid design-system color, and check_contrast to answer WCAG AA/AAA contrast questions. " +
  "Always use actual values from the tools — never guess or invent values.\n\n" +
  "IMPORTANT: Every response must be a single valid JSON object. Output ONLY the JSON.\n" +
  'Return: {"schemaVersion":"1.0","message":"Your prose answer here.","preview":"<optional rendered demo>","metadata":{"agent":"reader"}}\n' +
  '  • "schemaVersion": use "1.0". Required.\n' +
  '  • "message": plain prose text — no HTML, no code fences, no emojis. Required.\n' +
  '  • "preview": optional raw HTML with inline styles demonstrating the tokens in context. Include this whenever the response covers visually demonstrable tokens:\n' +
  "      - Typography: render a sample text block for each size/weight/line-height using the exact token values, labelled with the token name.\n" +
  "      - Colors: render a row of swatches, each a filled div showing the color with its token name and hex value.\n" +
  "      - Spacing: render labelled boxes whose padding or margin matches each spacing token value.\n" +
  "      - Shadows, border-radius: render example boxes applying the token values.\n" +
  "      - Themes: render a side-by-side panel showing semantic tokens applied in each theme.\n" +
  "    Use a dark background (#1a1a2e or similar) so the demo looks good in the preview pane. No code fences, no wrappers. Omit entirely for non-visual responses (changelog, deprecations, accessibility text, etc.).";

export const BUILDER_SYSTEM_PROMPT =
  "You are a component code generator. For every component request:\n" +
  "1. If the component name is unclear, call list_components to discover available components.\n" +
  "2. Call get_component to fetch the spec and available variants.\n" +
  "3. Call get_component_tokens to resolve the exact token values. Optionally call suggest_token to map semantic names to exact values.\n" +
  "4. Optionally call get_component_variants or get_component_anatomy to understand valid configurations and slot structure.\n" +
  "5. Optionally call get_component_relationships to discover sibling or parent components needed for composite layouts.\n" +
  "6. Optionally call get_component_constraints or get_accessibility_guidance to apply ARIA roles, keyboard patterns, and usage rules.\n" +
  "7. Optionally call validate_component_usage or diff_against_system to verify your final configuration against design system rules.\n" +
  "Generate clean HTML with inline styles using exact token values from the tools. Never hard-code colors or spacing.\n\n" +
  "IMPORTANT: Every response must be a single valid JSON object. Output ONLY the JSON.\n" +
  'Return: {"schemaVersion":"1.0","message":"Brief prose explanation.","preview":"<html with inline styles>","metadata":{"agent":"builder"}}\n' +
  '  • "schemaVersion": use "1.0". Required.\n' +
  '  • "message": plain prose — no HTML, no emojis. Required.\n' +
  '  • "preview": raw HTML only — no fences, no wrappers. Omit when no UI is generated.';

export const GENERATOR_SYSTEM_PROMPT =
  "You are a design system architect. Help users create complete new design systems through conversation.\n" +
  "1. Gather brand name, product type, aesthetic direction, primary and secondary colors, and typography preferences.\n" +
  "2. Ask one clarifying question at a time until you have a clear brand direction (typically 2–4 exchanges).\n" +
  "3. Once you have enough information, call generate_design_system with a comprehensive, detailed description.\n" +
  "4. After the tool returns success, briefly summarise what was generated and tell the user it is loaded and ready to explore.\n\n" +
  "IMPORTANT: Every response must be a single valid JSON object. Output ONLY the JSON.\n" +
  'Return: {"schemaVersion":"1.0","message":"Your prose here. No emojis.","metadata":{"agent":"generator"}}';

export const STYLE_GUIDE_SYSTEM_PROMPT =
  "You are a design system style guide expert. Your role is to explain design principles, color usage rules, " +
  "typography guidelines, and composition patterns from the style guide.\n" +
  "1. Call get_style_guide with the relevant section (principles, colorUsage, typographyUsage, compositionPatterns, or all).\n" +
  "2. Use get_token or get_tokens to resolve exact token values when explaining color or typography guidance.\n" +
  "3. Use check_contrast to verify or demonstrate color pairing contrast ratios referenced in the color usage rules.\n" +
  "Answer with clear, actionable guidance grounded in the actual style guide content — never guess or invent values.\n\n" +
  "IMPORTANT: Every response must be a single valid JSON object. Output ONLY the JSON.\n" +
  'Return: {"schemaVersion":"1.0","message":"Your prose answer here.","preview":"<optional rendered demo>","metadata":{"agent":"style-guide"}}\n' +
  '  • "schemaVersion": use "1.0". Required.\n' +
  '  • "message": plain prose — no HTML, no code fences, no emojis. Required.\n' +
  '  • "preview": optional raw HTML with inline styles. Include this for color pairings or typography hierarchy demos. Omit for principle or pattern descriptions.';  

// ── Tool subsets per specialist agent ────────────────────────────────────
// Each specialist only receives the tools relevant to its role.
// Narrowing the tool set improves routing accuracy and reduces token usage.
// ─────────────────────────────────────────────────────────────────────────
const READER_TOOL_NAMES = new Set([
  "list_token_categories", "get_tokens", "get_token", "suggest_token", "get_spacing_scale",
  "list_components", "get_component", "get_component_tokens", "get_component_constraints",
  "get_component_variants", "get_component_anatomy", "get_component_relationships",
  "list_themes", "get_theme", "list_icons", "get_icon", "search_icons", "search",
  "get_schema", "get_layout_guidance", "get_accessibility_guidance", "get_changelog", "get_deprecations",
  "validate_color", "check_contrast",
  "diff_against_system",
  "get_style_guide",
]);

const BUILDER_TOOL_NAMES = new Set([
  "list_components",
  "get_token", "get_tokens",
  "get_component", "get_component_tokens", "get_component_variants", "get_component_anatomy",
  "get_component_constraints", "get_component_relationships", "get_accessibility_guidance",
  "suggest_token", "validate_component_usage", "validate_color", "diff_against_system", "check_contrast",
]);

const GENERATOR_TOOL_NAMES = new Set([
  "generate_design_system",
]);

const STYLE_GUIDE_TOOL_NAMES = new Set([
  "get_style_guide",
  "get_token",
  "get_tokens",
  "check_contrast",
]);

function filterTools(nameSet: Set<string>) {
  return OPENROUTER_TOOLS.filter((t) => nameSet.has(t.function.name));
}

// ── Routing tool used by the Orchestrator ────────────────────────────────
// Extracted as a constant so both routes/agent.ts and routes/chat.ts
// reference the same definition without duplication.
// ─────────────────────────────────────────────────────────────────────────
export const DELEGATE_TOOL = {
  type: "function" as const,
  function: {
    name: "delegate_to_agent",
    description: 'Route the conversation to a specialist. agent must be "reader", "builder", "generator", or "style-guide".',
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["reader", "builder", "generator", "style-guide"],
          description: "The specialist agent to delegate to.",
        },
        reason: { type: "string", description: "One-sentence rationale for the routing decision." },
      },
      required: ["agent", "reason"],
    },
  },
};

// ── Pre-computed per-agent configs ───────────────────────────────────────
// Used in both routes/agent.ts (/api/agent-info) and routes/chat.ts
// (the routing step).  maxIterations caps the agentic loop per specialist.
// ─────────────────────────────────────────────────────────────────────────
export const SPECIALIST_CONFIGS = {
  reader: {
    systemPrompt: READER_SYSTEM_PROMPT,
    tools: filterTools(READER_TOOL_NAMES),
    maxIterations: 5,
  },
  builder: {
    systemPrompt: BUILDER_SYSTEM_PROMPT,
    tools: filterTools(BUILDER_TOOL_NAMES),
    maxIterations: 6,
  },
  generator: {
    systemPrompt: GENERATOR_SYSTEM_PROMPT,
    tools: filterTools(GENERATOR_TOOL_NAMES),
    // The generator prompt asks for 2–4 clarifying exchanges before calling
    // generate_design_system, then a confirmation message — 8 iterations
    // allows that full flow without hitting the cap prematurely.
    maxIterations: 8,
  },
  "style-guide": {
    systemPrompt: STYLE_GUIDE_SYSTEM_PROMPT,
    tools: filterTools(STYLE_GUIDE_TOOL_NAMES),
    maxIterations: 4,
  },
} as const;

export type SpecialistName = keyof typeof SPECIALIST_CONFIGS;
