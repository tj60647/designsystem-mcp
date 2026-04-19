/**
 * Design System MCP — JSON Schemas for each data file
 *
 * Single source of truth for the JSON Schema (draft-07) definitions used by:
 *   - the `get_schema` MCP tool in mcp-server.ts
 *   - the `get_schema` case in toolRunner.ts
 *
 * Schemas describe the expected shape of each data file so that MCP clients
 * and the demo UI's Load JSON modal can validate custom data before loading.
 */

const TOKEN_ENTRY_SCHEMA = {
  type: "object",
  required: ["$value", "$type"],
  properties: {
    $value:       { type: "string", description: "The raw token value, e.g. '#2563eb' or '16px'. May be an alias reference like '{color.primary.600}'." },
    $type:        { type: "string", description: "Token type, e.g. 'color', 'dimension', 'fontFamily'. Follows the W3C Design Token Community Group spec." },
    $description: { type: "string", description: "Human-readable description of the token's intent." },
  },
  additionalProperties: false,
};

// Schema bodies (without $schema / title) are extracted so they can be
// reused as nested property schemas inside the combined "design-system" schema.

const TOKENS_SCHEMA_BODY = {
  description:
    "Design token file. Top-level keys are token categories (color, typography, spacing, …). " +
    "Each category is a nested object whose leaf nodes follow the token-entry shape.",
  type: "object",
  properties: {
    color:        { type: "object", description: "Color tokens — primary, neutral, semantic…" },
    typography:   { type: "object", description: "Typography tokens — fontFamily, fontSize, fontWeight, lineHeight…" },
    spacing:      { type: "object", description: "Spacing tokens — numeric step keys (1–16) mapped to px values." },
    borderRadius: { type: "object", description: "Border-radius tokens — sm, md, lg, full…" },
    shadow:       { type: "object", description: "Box-shadow tokens — sm, md, lg…" },
    motion:       { type: "object", description: "Motion tokens — duration, easing…" },
    layout:       { type: "object", description: "Layout tokens — grid columns, breakpoints, z-index…" },
  },
  additionalProperties: {
    type: "object",
    description: "Custom token category. Leaf nodes must follow the token-entry shape.",
  },
  definitions: { tokenEntry: TOKEN_ENTRY_SCHEMA },
};

const COMPONENTS_SCHEMA_BODY = {
  description: "Component specifications. Each key is a lowercase component name (e.g. 'button', 'input').",
  type: "object",
  additionalProperties: {
    type: "object",
    required: ["name", "description"],
    properties: {
      name:          { type: "string", description: "Display name, e.g. 'Button'." },
      description:   { type: "string", description: "One-sentence description of the component." },
      variants:      { type: "array", items: { type: "string" }, description: "Allowed variant values, e.g. ['primary','secondary','ghost']." },
      sizes:         { type: "array", items: { type: "string" }, description: "Allowed size values, e.g. ['sm','md','lg']." },
      states:        { type: "array", items: { type: "string" }, description: "Allowed state values, e.g. ['default','hover','disabled']." },
      props:         { type: "object", description: "Prop definitions keyed by prop name." },
      tokens:        { type: "object", description: "Token references used by this component. Values use '{token.path}' syntax." },
      constraints:   { type: "array", items: { type: "string" }, description: "Usage rules for this component." },
      accessibility: { type: "object", description: "Accessibility requirements for this component." },
    },
    additionalProperties: false,
  },
};

const THEMES_SCHEMA_BODY = {
  description: "Theme definitions. Each key is a theme identifier (e.g. 'light', 'dark').",
  type: "object",
  additionalProperties: {
    type: "object",
    required: ["name", "description", "semantic"],
    properties: {
      name:        { type: "string", description: "Display name, e.g. 'Dark Mode'." },
      description: { type: "string", description: "What this theme is for." },
      semantic: {
        type: "object",
        description: "Semantic token overrides. Keys are semantic token paths; values are resolved CSS values.",
        additionalProperties: { type: "string" },
      },
    },
    additionalProperties: false,
  },
};

const ICONS_SCHEMA_BODY = {
  description: "Icon metadata. Each key is a lowercase icon identifier.",
  type: "object",
  additionalProperties: {
    type: "object",
    required: ["name", "category", "keywords", "sizes", "description"],
    properties: {
      name:        { type: "string", description: "Display name of the icon." },
      category:    { type: "string", description: "Icon category, e.g. 'action', 'navigation'." },
      keywords:    { type: "array", items: { type: "string" }, description: "Search keywords for the icon." },
      sizes:       { type: "array", items: { type: "number" }, description: "Supported sizes in px, e.g. [16, 24, 32]." },
      description: { type: "string", description: "Short description of what the icon represents." },
    },
    additionalProperties: false,
  },
};

const STYLE_GUIDE_SCHEMA_BODY = {
  description: "Style guide: design principles, color usage rules, typography usage guidelines, and composition patterns.",
  type: "object",
  properties: {
    principles: {
      type: "array",
      description: "Design principles guiding all decisions.",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name:        { type: "string", description: "Principle name." },
          description: { type: "string", description: "Detailed description." },
          implication: { type: "string", description: "Practical implication for designers and developers." },
        },
      },
    },
    colorUsage: {
      type: "object",
      description: "Color role definitions with approved pairings, contrast ratios, and usage notes.",
    },
    typographyUsage: {
      type: "object",
      description: "Typography hierarchy, scale intent, font pairings, and line-length guidance.",
    },
    compositionPatterns: {
      type: "array",
      description: "Named composition patterns with component lists, spacing conventions, and slot definitions.",
      items: { type: "object" },
    },
  },
};

export const DATA_SCHEMAS: Record<string, unknown> = {
  tokens: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "tokens.json",
    ...TOKENS_SCHEMA_BODY,
  },

  components: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "components.json",
    ...COMPONENTS_SCHEMA_BODY,
  },

  themes: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "themes.json",
    ...THEMES_SCHEMA_BODY,
  },

  icons: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "icons.json",
    ...ICONS_SCHEMA_BODY,
  },

  "style-guide": {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "style-guide.json",
    ...STYLE_GUIDE_SCHEMA_BODY,
  },

  "design-system": {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "design-system.json",
    description:
      "Combined design system file. Core data sets plus an optional style guide in a single JSON object. " +
      "Load this instead of individual files to replace all design system data at once.",
    type: "object",
    required: ["tokens", "components", "themes", "icons"],
    properties: {
      tokens:          TOKENS_SCHEMA_BODY,
      components:      COMPONENTS_SCHEMA_BODY,
      themes:          THEMES_SCHEMA_BODY,
      icons:           ICONS_SCHEMA_BODY,
      "style-guide":   STYLE_GUIDE_SCHEMA_BODY,
    },
    additionalProperties: false,
  },
};
