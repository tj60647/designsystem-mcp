/**
 * Design System MCP — Tool Runner
 *
 * Provides a single `runMcpTool(name, args)` function that executes any of the
 * 27 design-system tools and returns a plain string result. Used by the
 * /api/chat agentic loop to execute OpenRouter tool-call responses locally
 * without going through the full MCP JSON-RPC protocol.
 *
 * Data is read from the shared dataStore on every call so that JSON loaded
 * via POST /api/data is immediately reflected in chat tool responses.
 */

import { getData } from "./dataStore.js";
import { DATA_SCHEMAS } from "./schemas.js";
import { recordToolCall } from "./metrics.js";

// ── Data ──────────────────────────────────────────────────────────────────
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
interface ComponentSpec {
  name:             string;
  description:      string;
  variants?:        string[];
  variantGuidance?: Record<string, string>;
  sizes?:           string[];
  states?:          string[];
  props?:           Record<string, unknown>;
  tokens?:          Record<string, unknown>;
  constraints?:     string[];
  accessibility?:   Record<string, unknown>;
  anatomy?:         Record<string, unknown>;
  relationships?:   Record<string, unknown>;
  relatedComponents?: string[];
}
interface ComponentsData { [key: string]: ComponentSpec; }
interface ThemeSpec { name: string; description: string; semantic: Record<string, string>; }
interface ThemesData { [key: string]: ThemeSpec; }
interface IconSpec {
  name: string; category: string; keywords: string[];
  sizes: number[]; description: string;
}
interface IconsData { [key: string]: IconSpec; }
interface ChangelogEntry {
  version: string; date: string; summary: string;
  added: string[]; changed: string[]; deprecated: string[]; removed: string[];
}
interface DeprecationEntry {
  type: string; name: string; deprecatedSince: string; removalVersion: string;
  reason: string; migrationPath: string; replacements: string[];
}

// ── Utilities ─────────────────────────────────────────────────────────────

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur !== null && typeof cur === "object") return (cur as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function flattenTokenValues(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fp = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && "$value" in (val as object)) {
      result[fp] = (val as TokenEntry).$value;
    } else if (val !== null && typeof val === "object") {
      Object.assign(result, flattenTokenValues(val as Record<string, unknown>, fp));
    }
  }
  return result;
}

function flattenAllTokens(
  obj: Record<string, unknown>, prefix = ""
): Record<string, { value: string; type: string; description?: string }> {
  const result: Record<string, { value: string; type: string; description?: string }> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fp = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && "$value" in (val as object)) {
      const e = val as TokenEntry;
      result[fp] = { value: e.$value, type: e.$type, ...(e.$description ? { description: e.$description } : {}) };
    } else if (val !== null && typeof val === "object") {
      Object.assign(result, flattenAllTokens(val as Record<string, unknown>, fp));
    }
  }
  return result;
}

function extractTokenRefs(obj: unknown, refs: Set<string>): void {
  if (typeof obj === "string" && obj.startsWith("{") && obj.endsWith("}")) {
    refs.add(obj.slice(1, -1));
  } else if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) extractTokenRefs(val, refs);
  }
}

function parseHexColor(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(cleaned)) return null;
  const full = cleaned.length === 3 ? cleaned.split("").map(c => c + c).join("") : cleaned;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function contrastRatio(fg: string, bg: string): number | null {
  const r1 = parseHexColor(fg), r2 = parseHexColor(bg);
  if (!r1 || !r2) return null;
  const lum = (rgb: [number, number, number]) => 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
  const l1 = lum(r1), l2 = lum(r2);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Tool runner ───────────────────────────────────────────────────────────

export async function runMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  recordToolCall(name);
  const tokens       = getData("tokens")       as TokensData;
  const components   = getData("components")   as ComponentsData;
  const icons        = getData("icons")        as IconsData;
  const themes       = getData("themes")       as ThemesData;
  const changelog    = getData("changelog")    as ChangelogEntry[];
  const deprecations = getData("deprecations") as DeprecationEntry[];
  const styleGuide   = getData("style-guide")  as Record<string, unknown>;

  switch (name) {

    // ── v0.1.0 tools ────────────────────────────────────────────────────

    case "list_token_categories": {
      return JSON.stringify({ categories: Object.keys(tokens) }, null, 2);
    }

    case "get_tokens": {
      const category = args.category as string | undefined;
      if (category && !(category in tokens)) {
        return `Category "${category}" not found. Available: ${Object.keys(tokens).join(", ")}`;
      }
      const data = category ? tokens[category as keyof TokensData] : tokens;
      return JSON.stringify(data, null, 2);
    }

    case "get_token": {
      const tokenPath = args.tokenPath as string;
      const value = getByPath(tokens as unknown as Record<string, unknown>, tokenPath);
      if (value === undefined) {
        return `Token "${tokenPath}" not found. Use list_token_categories and get_tokens to explore available tokens.`;
      }
      return JSON.stringify({ path: tokenPath, token: value }, null, 2);
    }

    case "list_components": {
      const summary = Object.entries(components).map(([key, spec]) => ({
        key, name: spec.name, description: spec.description, variants: spec.variants ?? [], sizes: spec.sizes ?? [],
      }));
      return JSON.stringify({ components: summary }, null, 2);
    }

    case "get_component": {
      const key  = (args.componentName as string).toLowerCase().trim();
      const spec = components[key];
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;
      return JSON.stringify(spec, null, 2);
    }

    case "get_component_tokens": {
      const key  = (args.componentName as string).toLowerCase().trim();
      const spec = components[key];
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;
      const refs = new Set<string>();
      extractTokenRefs(spec.tokens, refs);
      return JSON.stringify({ component: spec.name, tokenReferences: Array.from(refs).sort(), rawTokenDefinitions: spec.tokens }, null, 2);
    }

    case "validate_color": {
      const colorValue = args.colorValue as string;
      const normalized = colorValue.trim().toLowerCase();
      const colorFlat  = flattenTokenValues(tokens.color as unknown as Record<string, unknown>, "color");
      const matches    = Object.entries(colorFlat)
        .filter(([, v]) => v.toLowerCase() === normalized)
        .map(([path, val]) => ({ tokenPath: path, value: val }));
      if (matches.length > 0) {
        return JSON.stringify({ input: colorValue, compliant: true, matchingTokens: matches, message: "This color value is a recognized design token. Use the token path instead of the raw value in production code." }, null, 2);
      }
      return JSON.stringify({ input: colorValue, compliant: false, matchingTokens: [], message: "This color is not part of the design token system. Replace it with a named token (e.g. color.primary.600) to stay compliant." }, null, 2);
    }

    case "get_component_constraints": {
      const key  = (args.componentName as string).toLowerCase().trim();
      const spec = components[key];
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;
      return JSON.stringify({ component: spec.name, constraints: spec.constraints ?? [], accessibility: spec.accessibility ?? {} }, null, 2);
    }

    case "validate_component_usage": {
      const key    = (args.componentName as string).toLowerCase().trim();
      const spec   = components[key];
      const config = (args.config ?? {}) as Record<string, unknown>;
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;

      const violations: Array<{ rule: string; suggestion: string }> = [];
      if (config.variant !== undefined && spec.variants && !spec.variants.includes(String(config.variant))) {
        violations.push({
          rule: `Variant "${config.variant}" is not valid for ${spec.name}. Allowed: ${spec.variants.join(", ")}.`,
          suggestion: `Change variant to one of: ${spec.variants.join(", ")}.`,
        });
      }
      if (config.size !== undefined && spec.sizes && !spec.sizes.includes(String(config.size))) {
        violations.push({
          rule: `Size "${config.size}" is not valid for ${spec.name}. Allowed: ${spec.sizes.join(", ")}.`,
          suggestion: `Change size to one of: ${spec.sizes.join(", ")}.`,
        });
      }
      if (config.state !== undefined && spec.states && !spec.states.includes(String(config.state))) {
        violations.push({
          rule: `State "${config.state}" is not valid for ${spec.name}. Allowed: ${spec.states.join(", ")}.`,
          suggestion: `Change state to one of: ${spec.states.join(", ")}.`,
        });
      }
      if (spec.props) {
        const reserved = new Set(["variant", "size", "state"]);
        for (const propKey of Object.keys(config)) {
          if (!reserved.has(propKey) && !(propKey in spec.props)) {
            violations.push({
              rule: `Unknown prop "${propKey}" - not defined in the ${spec.name} spec.`,
              suggestion: `Remove "${propKey}" or replace with a valid prop. Valid props: ${Object.keys(spec.props).join(", ")}.`,
            });
          }
        }
      }
      return JSON.stringify({ component: spec.name, valid: violations.length === 0, violations, checkedProps: Object.keys(config) }, null, 2);
    }

    case "suggest_token": {
      const intent      = args.intent as string;
      const category    = args.category as string | undefined;
      const intentWords = intent.toLowerCase().split(/[\s\-_./]+/).filter(Boolean);
      const source: Record<string, unknown> = category
        ? { [category]: tokens[category as keyof TokensData] }
        : (tokens as unknown as Record<string, unknown>);
      const flat   = flattenAllTokens(source);
      const scored = Object.entries(flat).map(([tokenPath, meta]) => {
        const segs = tokenPath.toLowerCase().split(".");
        let score  = 0;
        for (const word of intentWords) {
          for (const seg of segs) if (seg.includes(word) || word.includes(seg)) score += 2;
          if (meta.description) {
            for (const dw of meta.description.toLowerCase().split(/\W+/)) {
              if (dw && (dw.includes(word) || word.includes(dw))) score += 3;
            }
          }
        }
        return { tokenPath, value: meta.value, type: meta.type, description: meta.description ?? null, score };
      });
      const top5 = scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      if (top5.length === 0) return JSON.stringify({ intent, results: [], message: "No tokens matched. Try different keywords." }, null, 2);
      return JSON.stringify({ intent, results: top5 }, null, 2);
    }

    case "diff_against_system": {
      const properties = (args.properties ?? {}) as Record<string, string>;
      const allFlat    = flattenAllTokens(tokens as unknown as Record<string, unknown>);
      const reverseMap: Record<string, string[]> = {};
      for (const [path, meta] of Object.entries(allFlat)) {
        (reverseMap[meta.value.toLowerCase()] ??= []).push(path);
      }
      const results = Object.entries(properties).map(([property, value]) => {
        const matches = reverseMap[value.toLowerCase()];
        if (matches && matches.length > 0) return { property, value, status: "token-matched" as const, matchingTokens: matches };
        return { property, value, status: "no-token-match" as const, suggestion: "Replace with a design token" };
      });
      const matched = results.filter(r => r.status === "token-matched").length;
      const total   = results.length;
      const vCount  = total - matched;
      return JSON.stringify({
        compliant: vCount === 0,
        summary: `${matched} of ${total} properties match design tokens. ${vCount} violation${vCount === 1 ? "" : "s"} found.`,
        results,
      }, null, 2);
    }

    case "search": {
      const query      = args.query as string;
      const limit      = (args.limit as number | undefined) ?? 10;
      const queryWords = query.toLowerCase().split(/[\s\-_./,;:!?]+/).filter(Boolean);
      type SR = { type: "token" | "component" | "icon"; key: string; score: number; preview: string };
      const results: SR[] = [];
      const flat = flattenAllTokens(tokens as unknown as Record<string, unknown>);
      for (const [tokenPath, meta] of Object.entries(flat)) {
        const segs = tokenPath.toLowerCase().split(".");
        let score = 0;
        for (const word of queryWords) {
          for (const seg of segs) if (seg.includes(word) || word.includes(seg)) score += 2;
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
      return JSON.stringify({ query, results: results.slice(0, limit) }, null, 2);
    }

    case "get_schema": {
      const dataType = args.dataType as string;
      if (!(dataType in DATA_SCHEMAS)) return JSON.stringify({ error: `Unknown dataType "${dataType}". Valid values: tokens, components, themes, icons.` });
      return JSON.stringify(DATA_SCHEMAS[dataType], null, 2);
    }

    // ── v0.2.0 tools ────────────────────────────────────────────────────

    case "list_themes": {
      const summary = Object.entries(themes).map(([key, spec]) => ({ key, name: spec.name, description: spec.description }));
      return JSON.stringify({ themes: summary }, null, 2);
    }

    case "get_theme": {
      const key  = (args.themeName as string).toLowerCase().trim();
      const spec = themes[key];
      if (!spec) return `Theme "${args.themeName}" not found. Available: ${Object.keys(themes).join(", ")}`;
      return JSON.stringify({ key, ...spec }, null, 2);
    }

    case "list_icons": {
      const category = args.category as string | undefined;
      const tag      = args.tag as string | undefined;
      let entries    = Object.entries(icons);
      if (category) entries = entries.filter(([, icon]) => icon.category.toLowerCase() === category.toLowerCase());
      if (tag) {
        const tagLower = tag.toLowerCase();
        entries = entries.filter(([, icon]) => icon.keywords.some(k => k.toLowerCase().includes(tagLower)) || icon.name.toLowerCase().includes(tagLower));
      }
      const summary = entries.map(([key, icon]) => ({ key, name: icon.name, category: icon.category, keywords: icon.keywords, sizes: icon.sizes, description: icon.description }));
      return JSON.stringify({ icons: summary, total: summary.length }, null, 2);
    }

    case "get_icon": {
      const key  = (args.iconName as string).toLowerCase().trim().replace(/\s+/g, "-");
      const icon = icons[key];
      if (!icon) return `Icon "${args.iconName}" not found. Use search_icons to find icons semantically.`;
      return JSON.stringify({ key, ...icon }, null, 2);
    }

    case "search_icons": {
      const query      = args.query as string;
      const limit      = (args.limit as number | undefined) ?? 5;
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
      return JSON.stringify({ query, results }, null, 2);
    }

    case "check_contrast": {
      const foreground = args.foreground as string;
      const background = args.background as string;
      const ratio = contrastRatio(foreground, background);
      if (ratio === null) return `Could not parse colors "${foreground}" and/or "${background}". Provide hex values like "#2563eb".`;
      const r = Math.round(ratio * 100) / 100;
      return JSON.stringify({
        foreground, background, ratio: r,
        normalText:   { aa: r >= 4.5, aaa: r >= 7.0 },
        largeText:    { aa: r >= 3.0, aaa: r >= 4.5 },
        uiComponents: { aa: r >= 3.0 },
        summary: r >= 7.0 ? "Passes WCAG AAA for all text sizes."
          : r >= 4.5 ? "Passes WCAG AA for normal text. Fails AAA for normal text."
          : r >= 3.0 ? "Passes WCAG AA for large text and UI components only. Fails AA for normal text."
          : "Fails all WCAG contrast requirements.",
      }, null, 2);
    }

    case "get_accessibility_guidance": {
      const key  = (args.componentName as string).toLowerCase().trim();
      const spec = components[key];
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;
      const a11yConstraints = (spec.constraints ?? []).filter(c =>
        c.toLowerCase().includes("aria") || c.toLowerCase().includes("keyboard") ||
        c.toLowerCase().includes("focus") || c.toLowerCase().includes("wcag") ||
        c.toLowerCase().includes("screen reader") || c.toLowerCase().includes("touch") ||
        c.toLowerCase().includes("accessible")
      );
      return JSON.stringify({ component: spec.name, accessibility: spec.accessibility ?? {}, accessibilityConstraints: a11yConstraints }, null, 2);
    }

    case "get_component_variants": {
      const key  = (args.componentName as string).toLowerCase().trim();
      const spec = components[key];
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;
      const variants = (spec.variants ?? []).map(v => ({
        variant:  v,
        guidance: spec.variantGuidance?.[v] ?? `No specific guidance defined for variant "${v}".`,
      }));
      return JSON.stringify({ component: spec.name, variants, sizes: spec.sizes ?? [], states: spec.states ?? [] }, null, 2);
    }

    case "get_component_anatomy": {
      const key  = (args.componentName as string).toLowerCase().trim();
      const spec = components[key];
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;
      if (!spec.anatomy) return JSON.stringify({ component: spec.name, anatomy: null, message: "Anatomy not defined for this component." }, null, 2);
      return JSON.stringify({ component: spec.name, anatomy: spec.anatomy }, null, 2);
    }

    case "get_component_relationships": {
      const key  = (args.componentName as string).toLowerCase().trim();
      const spec = components[key];
      if (!spec) return `Component "${args.componentName}" not found. Available: ${Object.keys(components).join(", ")}`;
      const relationships = spec.relationships
        ?? (spec.relatedComponents ? { parent: null, siblings: [], related: spec.relatedComponents, children: [], composedIn: [] } : null);
      return JSON.stringify({ component: spec.name, relationships }, null, 2);
    }

    case "get_layout_guidance": {
      const context = args.context as string | undefined;
      const layoutTokens = tokens.layout as Record<string, unknown>;
      return JSON.stringify({
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
      }, null, 2);
    }

    case "get_spacing_scale": {
      const spacingTokens = tokens.spacing as Record<string, TokenEntry>;
      const semanticHints: Record<string, string> = {
        "0":  "No spacing; for elements that touch.", "1":  "4px - icon-to-text gap, tight inline spacing.",
        "2":  "8px - between label and input, between icon and label.", "3":  "12px - compact padding inside small components.",
        "4":  "16px - standard component padding, between form fields.", "5":  "20px - generous intra-component padding.",
        "6":  "24px - between related groups of components.", "8":  "32px - between card components, section sub-headers.",
        "10": "40px - between major content groups.", "12": "48px - between page sections (small).",
        "16": "64px - between major page sections.", "20": "80px - hero sections, large visual separators.",
        "24": "96px - very large page-level spacing.",
      };
      const scale = Object.entries(spacingTokens).map(([key, entry]) => ({
        token: `spacing.${key}`, value: entry.$value, type: entry.$type,
        usage: semanticHints[key] ?? `spacing.${key} - ${entry.$value}`,
      }));
      return JSON.stringify({ spacingScale: scale }, null, 2);
    }

    case "get_changelog": {
      const fromVersion = args.fromVersion as string | undefined;
      const toVersion   = args.toVersion   as string | undefined;
      const parseVer    = (v: string) => v.split(".").map(Number);
      const cmp         = (a: string, b: string) => {
        const pa = parseVer(a), pb = parseVer(b);
        for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
        return 0;
      };
      const entries = changelog.filter(e => {
        if (fromVersion && cmp(e.version, fromVersion) < 0) return false;
        if (toVersion   && cmp(e.version, toVersion)   > 0) return false;
        return true;
      });
      return JSON.stringify({ changelog: entries }, null, 2);
    }

    case "get_deprecations": {
      const type     = (args.type as string | undefined) ?? "all";
      const filtered = type === "all" ? deprecations : deprecations.filter(d => d.type === type);
      return JSON.stringify({ deprecations: filtered, total: filtered.length }, null, 2);
    }

    case "get_style_guide": {
      const section = (args.section as string | undefined) ?? "all";
      const result  = section === "all" ? styleGuide : { [section]: styleGuide[section] };
      return JSON.stringify(result, null, 2);
    }

    case "generate_design_system": {
      // generate_design_system is handled directly by /api/chat before
      // runMcpTool is called; this case is intentionally unreachable and
      // kept only as a safety net.
      return JSON.stringify({ error: "generate_design_system must be invoked through /api/chat" });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

