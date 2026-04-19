/**
 * Design System MCP — Shared Ingest Service
 *
 * Single pipeline for all design-system data entry points. All import
 * pathways — manual JSON load (/api/data) and website generation
 * (/api/generate-from-website) — flow through this module so that
 * behaviour is consistent and drift between routes is impossible.
 *
 * Pipeline stages (Import/Export Rollout Plan Phases 0–3.5):
 *   1. validate input shape (compatibility validation, Phase 3)
 *   2. normalize section shapes and token paths (Phase 2)
 *   3. canonical validation — hard-error policy (Phase 3)
 *   4. enrich defaults (minimal safe fills)
 *   5. persist via setData()
 *   6. evaluate readiness (Phase 3.5)
 *   7. return structured { loaded, warnings, errors, normalizationSummary, readiness }
 *
 * Phase 0 — Baseline logging: every ingest call is logged with path usage
 * and any fallback hits so behaviour is observable before deeper refactors.
 */

import { setData, type DataType } from "./dataStore.js";

export interface IngestWarning {
  code: string;
  section: string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface NormalizationSummary {
  renamedKeys: number;
  filledDefaults: number;
  droppedUnknownSections: number;
}

export type ReadinessStatus = "ready" | "usable-with-warnings" | "insufficient";

export interface ReadinessFinding {
  dimension: string;
  severity: "critical" | "warning" | "info";
  message: string;
  nextStep?: string;
}

export interface Readiness {
  status: ReadinessStatus;
  score: number;
  findings: ReadinessFinding[];
  nextSteps: string[];
}

export interface IngestResult {
  ok: boolean;
  type: string;
  loaded: string[];
  warnings: IngestWarning[];
  errors: IngestWarning[];
  normalizationSummary: NormalizationSummary;
  readiness: Readiness | null;
  message: string;
}

// Phase 0 — Baseline logger
function log(level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), level, event, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else if (level === "warn") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// Phase 3a — Compatibility validation (lenient, warns only)
function compatibilityCheck(section: DataType, data: Record<string, unknown>): IngestWarning[] {
  const warnings: IngestWarning[] = [];

  if (section === "tokens" && Object.keys(data).length === 0) {
    warnings.push({ code: "TOKENS_EMPTY", section, message: "tokens object is empty.", severity: "warning" });
  }

  if (section === "components") {
    for (const [key, comp] of Object.entries(data)) {
      const c = comp as Record<string, unknown>;
      if (!c || typeof c !== "object") continue;
      if (!c.name || !c.description) {
        warnings.push({
          code: "COMPONENT_MISSING_REQUIRED", section,
          message: `Component "${key}" is missing "name" or "description".`,
          severity: "warning",
        });
      }
    }
  }

  if (section === "themes") {
    for (const [key, theme] of Object.entries(data)) {
      const t = theme as Record<string, unknown>;
      if (!t || typeof t !== "object") continue;
      if (!t.semantic) {
        warnings.push({
          code: "THEME_MISSING_SEMANTIC", section,
          message: `Theme "${key}" has no "semantic" mapping. Token resolution may be incomplete.`,
          severity: "warning",
        });
      }
    }
  }

  return warnings;
}

// Phase 3b — Canonical validation (strict, hard errors block persistence)
function canonicalCheck(section: DataType, data: Record<string, unknown>): IngestWarning[] {
  const errors: IngestWarning[] = [];

  if (typeof data !== "object" || Array.isArray(data) || data === null) {
    errors.push({ code: "SECTION_NOT_OBJECT", section, message: `"${section}" must be a plain JSON object.`, severity: "error" });
    return errors;
  }

  if (section === "tokens") {
    function checkLeaves(obj: unknown, path: string): void {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
      const o = obj as Record<string, unknown>;
      const isLeaf = "$value" in o;
      if (isLeaf) {
        if (!("$type" in o))  errors.push({ code: "TOKEN_MISSING_TYPE",  section, message: `Token at "${path}" missing "$type".`,  severity: "error" });
        if (typeof o.$value !== "string") errors.push({ code: "TOKEN_VALUE_NOT_STRING", section, message: `Token at "${path}".$value must be a string.`, severity: "error" });
      } else {
        for (const k of Object.keys(o)) checkLeaves(o[k], `${path}.${k}`);
      }
    }
    for (const cat of Object.keys(data)) checkLeaves(data[cat], cat);
  }

  return errors;
}

// Phase 2 — Normalization (idempotent transforms with warning entries)
function normalize(
  section: DataType,
  data: Record<string, unknown>,
): { normalized: Record<string, unknown>; warnings: IngestWarning[]; summary: NormalizationSummary } {
  const warnings: IngestWarning[] = [];
  const summary: NormalizationSummary = { renamedKeys: 0, filledDefaults: 0, droppedUnknownSections: 0 };
  let normalized = { ...data };

  // Tokens: unwrap a top-level "tokens" wrapper key
  if (section === "tokens" && normalized.tokens && typeof normalized.tokens === "object" && !Array.isArray(normalized.tokens)) {
    const inner = normalized.tokens as Record<string, unknown>;
    const innerKeys = Object.keys(inner);
    // An empty inner object is treated as a valid (empty) categories container so that
    // { tokens: {} } is unwrapped to {} and the TOKENS_EMPTY compatibility check fires.
    const looksLikeCategories = innerKeys.length === 0 || innerKeys.every(k =>
      typeof inner[k] === "object" && inner[k] !== null && !Array.isArray(inner[k]));
    if (looksLikeCategories) {
      warnings.push({ code: "TOKENS_UNWRAPPED", section, message: 'Top-level "tokens" wrapper key unwrapped to canonical flat structure.', severity: "info" });
      normalized = inner;
      summary.renamedKeys++;
    }
  }

  // Tokens: normalize token reference paths "tokens.color.x" → "color.x"
  if (section === "tokens") {
    let pathNormCount = 0;
    function normalizeTokenPaths(obj: unknown): unknown {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
      const o = obj as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && v.startsWith("tokens.")) {
          result[k] = v.slice("tokens.".length);
          pathNormCount++;
        } else if (typeof v === "object") {
          result[k] = normalizeTokenPaths(v);
        } else {
          result[k] = v;
        }
      }
      return result;
    }
    const withNormalizedPaths = normalizeTokenPaths(normalized) as Record<string, unknown>;
    if (pathNormCount > 0) {
      warnings.push({ code: "TOKEN_PATH_NORMALIZED", section, message: `${pathNormCount} token reference path(s) normalized from "tokens.x.y" to "x.y".`, severity: "info" });
      summary.renamedKeys += pathNormCount;
      normalized = withNormalizedPaths;
    }
  }

  // Components: normalize common variant aliases
  if (section === "components") {
    const VARIANT_ALIASES: Record<string, string> = {
      "primary-btn": "primary", "secondary-btn": "secondary",
      "ghost-btn": "ghost", "destructive-btn": "destructive",
    };
    let aliasCount = 0;
    for (const [key, comp] of Object.entries(normalized)) {
      const c = comp as Record<string, unknown>;
      if (!c || !Array.isArray(c.variants)) continue;
      const newVariants = (c.variants as string[]).map(v => {
        const n = VARIANT_ALIASES[v.toLowerCase()] ?? v;
        if (n !== v) aliasCount++;
        return n;
      });
      (normalized[key] as Record<string, unknown>).variants = newVariants;
    }
    if (aliasCount > 0) {
      warnings.push({ code: "VARIANT_ALIAS_NORMALIZED", section, message: `${aliasCount} component variant alias(es) normalized to canonical names.`, severity: "info" });
      summary.renamedKeys += aliasCount;
    }
  }

  return { normalized, warnings, summary };
}

// Default enrichment (minimal safe fills only)
function enrichDefaults(
  section: DataType,
  data: Record<string, unknown>,
): { enriched: Record<string, unknown>; warnings: IngestWarning[]; filled: number } {
  const warnings: IngestWarning[] = [];
  let filled = 0;
  const enriched = { ...data };

  if (section === "themes") {
    for (const [key, theme] of Object.entries(enriched)) {
      const t = theme as Record<string, unknown>;
      if (t && typeof t === "object" && !("mode" in t)) {
        (enriched[key] as Record<string, unknown>)["mode"] = "light";
        filled++;
      }
    }
    if (filled > 0) {
      warnings.push({ code: "THEME_MODE_DEFAULTED", section, message: `Added default "mode": "light" to ${filled} theme(s).`, severity: "info" });
    }
  }

  return { enriched, warnings, filled };
}

// Phase 3.5 — Readiness evaluation
function evaluateReadiness(sections: Record<string, Record<string, unknown>>): Readiness {
  const findings: ReadinessFinding[] = [];
  let score = 100;

  const tokens    = sections["tokens"]     ?? {};
  const components = sections["components"] ?? {};
  const themes    = sections["themes"]     ?? {};

  // Coverage
  const missingRequired: string[] = [];
  if (Object.keys(tokens).length === 0)     missingRequired.push("tokens");
  if (Object.keys(components).length === 0) missingRequired.push("components");
  if (Object.keys(themes).length === 0)     missingRequired.push("themes");
  if (!sections["icons"] || Object.keys(sections["icons"]).length === 0) missingRequired.push("icons");

  if (missingRequired.length > 0) {
    score -= missingRequired.length * 20;
    findings.push({
      dimension: "coverage",
      severity: missingRequired.length >= 3 ? "critical" : "warning",
      message: `Missing sections: ${missingRequired.join(", ")}.`,
      nextStep: "Add the missing section(s) to your design system JSON.",
    });
  }

  // Token utility
  const CORE_CATEGORIES = ["color", "typography", "spacing"];
  const presentCats = Object.keys(tokens);
  const missingCats = CORE_CATEGORIES.filter(c => !presentCats.includes(c));
  if (missingCats.length > 0) {
    score -= missingCats.length * 8;
    findings.push({
      dimension: "token-utility",
      severity: "warning",
      message: `Core token categories missing: ${missingCats.join(", ")}.`,
      nextStep: `Add ${missingCats.join(" and ")} token categories.`,
    });
  }

  function countLeaves(obj: unknown): number {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 0;
    const o = obj as Record<string, unknown>;
    if ("$value" in o) return 1;
    return Object.values(o).reduce((acc: number, v) => acc + countLeaves(v), 0);
  }
  const totalTokens = Object.values(tokens).reduce((acc: number, v) => acc + countLeaves(v), 0);
  if (totalTokens > 0 && totalTokens < 10) {
    score -= 10;
    findings.push({
      dimension: "token-utility",
      severity: "warning",
      message: `Only ${totalTokens} token value(s) found; a typical system has 20+.`,
      nextStep: "Expand token definitions for better AI accuracy.",
    });
  }

  // Component utility
  const compEntries = Object.entries(components);
  const withVariants = compEntries.filter(([, c]) => {
    const comp = c as Record<string, unknown>;
    return Array.isArray(comp.variants) && (comp.variants as unknown[]).length > 0;
  });
  if (compEntries.length > 0 && withVariants.length === 0) {
    score -= 10;
    findings.push({
      dimension: "component-utility",
      severity: "warning",
      message: "No components have variant definitions.",
      nextStep: `Add "variants" arrays to your component definitions.`,
    });
  }

  // Theme utility
  const themeEntries = Object.entries(themes);
  if (themeEntries.length > 0 && !("light" in themes)) {
    score -= 5;
    findings.push({
      dimension: "theme-utility",
      severity: "info",
      message: 'No "light" theme found.',
      nextStep: `Add or rename a theme entry as "light".`,
    });
  }
  const withSemantic = themeEntries.filter(([, t]) => {
    const theme = t as Record<string, unknown>;
    return theme.semantic && typeof theme.semantic === "object" && Object.keys(theme.semantic as object).length > 0;
  });
  if (themeEntries.length > 0 && withSemantic.length === 0) {
    score -= 8;
    findings.push({
      dimension: "theme-utility",
      severity: "warning",
      message: "No themes have semantic token mappings.",
      nextStep: `Add "semantic" objects to theme definitions.`,
    });
  }

  score = Math.max(0, Math.min(100, score));
  const status: ReadinessStatus = score >= 80 ? "ready" : score >= 40 ? "usable-with-warnings" : "insufficient";
  const nextSteps = findings.filter(f => f.nextStep).map(f => f.nextStep as string).slice(0, 3);

  return { status, score, findings, nextSteps };
}

// ── Main ingest pipeline ──────────────────────────────────────────────────

const VALID_SECTIONS: DataType[] = ["tokens", "components", "themes", "icons", "style-guide"];
const REQUIRED_SECTIONS: DataType[] = ["tokens", "components", "themes", "icons"];

/**
 * Ingest a single section or a combined "design-system" payload.
 * Returns a structured result with warnings, errors, loaded sections,
 * normalization summary, and readiness evaluation.
 */
export async function ingest(
  source: string,
  type: "design-system" | DataType,
  data: Record<string, unknown>,
): Promise<IngestResult> {
  const allWarnings: IngestWarning[] = [];
  const allErrors: IngestWarning[] = [];
  const loaded: string[] = [];
  const totalSummary: NormalizationSummary = { renamedKeys: 0, filledDefaults: 0, droppedUnknownSections: 0 };
  const persistedSections: Record<string, Record<string, unknown>> = {};

  log("info", "ingest.started", { source, type, keys: Object.keys(data).length });

  const sectionsToProcess: Array<{ section: DataType; sectionData: Record<string, unknown> }> = [];

  if (type === "design-system") {
    for (const section of ([...REQUIRED_SECTIONS, "style-guide"] as DataType[])) {
      const raw = data[section];
      if (raw !== undefined) {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          allErrors.push({ code: "SECTION_INVALID_TYPE", section, message: `"${section}" must be a JSON object.`, severity: "error" });
          log("warn", "ingest.section.invalid_type", { source, section });
          continue;
        }
        sectionsToProcess.push({ section, sectionData: raw as Record<string, unknown> });
      }
    }
    for (const required of REQUIRED_SECTIONS) {
      if (!sectionsToProcess.find(s => s.section === required)) {
        allWarnings.push({ code: "SECTION_MISSING", section: required, message: `Required section "${required}" was not present.`, severity: "warning" });
        log("warn", "ingest.section.missing", { source, section: required });
      }
    }
    const knownKeys = new Set<string>([...REQUIRED_SECTIONS, "style-guide"]);
    for (const key of Object.keys(data)) {
      if (!knownKeys.has(key)) {
        allWarnings.push({ code: "UNKNOWN_SECTION", section: key, message: `Unknown key "${key}" will be ignored.`, severity: "warning" });
        totalSummary.droppedUnknownSections++;
        log("warn", "ingest.unknown_section", { source, key });
      }
    }
    if (sectionsToProcess.length === 0 && allErrors.length === 0) {
      allErrors.push({ code: "DESIGN_SYSTEM_EMPTY", section: "design-system", message: "Payload must contain at least one of: tokens, components, themes, icons, style-guide.", severity: "error" });
    }
  } else {
    if (!VALID_SECTIONS.includes(type)) {
      allErrors.push({ code: "UNKNOWN_TYPE", section: type, message: `Unknown type "${type}".`, severity: "error" });
    } else {
      sectionsToProcess.push({ section: type, sectionData: data });
    }
  }

  if (allErrors.length > 0) {
    log("error", "ingest.aborted", { source, type, errorCount: allErrors.length });
    return { ok: false, type, loaded: [], warnings: allWarnings, errors: allErrors, normalizationSummary: totalSummary, readiness: null, message: `Ingest failed: ${allErrors.map(e => e.message).join("; ")}` };
  }

  for (const { section, sectionData } of sectionsToProcess) {
    log("info", "ingest.section.started", { source, section });

    // Phase 2: Normalization runs first so that compat checks operate on the
    // canonical shape (e.g. an unwrapped tokens wrapper yields {} which then
    // correctly triggers the TOKENS_EMPTY warning on the next step).
    const { normalized, warnings: normWarnings, summary } = normalize(section, sectionData);
    allWarnings.push(...normWarnings);
    totalSummary.renamedKeys += summary.renamedKeys;
    totalSummary.droppedUnknownSections += summary.droppedUnknownSections;

    // Phase 3a: Compatibility validation — runs on normalized data
    const compatWarnings = compatibilityCheck(section, normalized);
    allWarnings.push(...compatWarnings);
    if (compatWarnings.length > 0) log("warn", "ingest.section.compat_warnings", { source, section, count: compatWarnings.length });

    // Phase 3b: Canonical validation (hard errors block persistence)
    const canonicalErrors = canonicalCheck(section, normalized);
    if (canonicalErrors.length > 0) {
      allErrors.push(...canonicalErrors);
      log("error", "ingest.section.canonical_errors", { source, section, count: canonicalErrors.length });
      continue;
    }

    // Default enrichment
    const { enriched, warnings: enrichWarnings, filled } = enrichDefaults(section, normalized);
    allWarnings.push(...enrichWarnings);
    totalSummary.filledDefaults += filled;

    // Persist
    setData(section, enriched);
    loaded.push(section);
    persistedSections[section] = enriched;
    log("info", "ingest.section.persisted", { source, section });
  }

  if (allErrors.length > 0) {
    log("error", "ingest.partial_abort", { source, type, errorCount: allErrors.length, loaded });
    return { ok: false, type, loaded, warnings: allWarnings, errors: allErrors, normalizationSummary: totalSummary, readiness: null, message: `Ingest partially failed. Loaded: ${loaded.join(", ") || "none"}. Errors: ${allErrors.map(e => e.message).join("; ")}` };
  }

  // Phase 3.5: Readiness evaluation
  let readiness: Readiness | null = null;
  if (type === "design-system" || loaded.length > 1) {
    readiness = evaluateReadiness(persistedSections as Record<string, Record<string, unknown>>);
    log("info", "ingest.readiness", { source, status: readiness.status, score: readiness.score });
  }

  const warnCount = allWarnings.length;
  log("info", "ingest.completed", { source, type, loaded, warnCount, normalizationSummary: totalSummary });

  const message = type === "design-system"
    ? `Design system data loaded (${loaded.join(", ")}).${warnCount > 0 ? ` ${warnCount} warning(s) noted.` : ""} MCP tools now reflect the new data.`
    : `${type} data replaced.${warnCount > 0 ? ` ${warnCount} warning(s) noted.` : ""} MCP tools now reflect the new data.`;

  return { ok: true, type, loaded, warnings: allWarnings, errors: [], normalizationSummary: totalSummary, readiness, message };
}
