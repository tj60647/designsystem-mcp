/**
 * Design System MCP — Data Routes
 * Author: Thomas J McLeish
 * License: MIT
 *
 * REST endpoints for reading, replacing, resetting, and validating
 * design system data at runtime.  Mounted at /api in index.ts.
 *
 * Routes:
 *   GET  /api/data/:type      — return active data for tokens/components/themes/icons
 *   POST /api/data            — replace active data via the shared ingest service
 *   POST /api/data/reset      — reset one or all data types to bundled defaults
 *   GET  /api/schema/:type    — download JSON Schema for a data type
 *   POST /api/validate        — validate JSON against a schema without loading it
 */

import express from "express";
import { getData, resetData, type DataType } from "../dataStore.js";
import { ingest } from "../ingestService.js";
import { DATA_SCHEMAS } from "../schemas.js";

const router = express.Router();

const VALID_TYPES: DataType[] = ["tokens", "components", "themes", "icons", "style-guide"];

// ── Lightweight structural validator ─────────────────────────────────────
// Called by POST /api/validate.  Checks the shape of each data type and
// returns actionable errors + best-practice recommendations.
// ─────────────────────────────────────────────────────────────────────────
function validateAgainstSchema(
  type: DataType | "design-system",
  data: Record<string, unknown>,
): { valid: boolean; errors: string[]; recommendations: string[] } {
  const errors: string[] = [];
  const recommendations: string[] = [];

  if (type === "design-system") {
    const REQUIRED_SECTIONS: DataType[] = ["tokens", "components", "themes", "icons"];
    const ALL_SECTIONS: DataType[] = [...REQUIRED_SECTIONS, "style-guide"];
    const keys = Object.keys(data);

    const unknown = keys.filter(k => !ALL_SECTIONS.includes(k as DataType));
    if (unknown.length > 0) {
      recommendations.push(
        `Unexpected top-level keys: ${unknown.map(k => `"${k}"`).join(", ")}. ` +
        `Expected keys are: ${ALL_SECTIONS.join(", ")}.`,
      );
    }

    for (const section of REQUIRED_SECTIONS) {
      if (!(section in data)) {
        recommendations.push(`Section "${section}" is missing. Add it to include ${section} data.`);
      }
    }

    for (const section of ALL_SECTIONS) {
      if (section in data) {
        const sectionData = data[section];
        if (sectionData === null || typeof sectionData !== "object" || Array.isArray(sectionData)) {
          errors.push(`"${section}" must be a JSON object.`);
        } else {
          const sub = validateAgainstSchema(section, sectionData as Record<string, unknown>);
          for (const e of sub.errors) errors.push(`[${section}] ${e}`);
          for (const r of sub.recommendations) recommendations.push(`[${section}] ${r}`);
        }
      }
    }

    return { valid: errors.length === 0, errors, recommendations };
  }

  if (type === "tokens") {
    const KNOWN_CATEGORIES = ["color", "typography", "spacing", "borderRadius", "shadow", "motion", "layout"];
    const keys = Object.keys(data);
    if (keys.length === 0) {
      errors.push("tokens.json must have at least one token category.");
    }
    const unknown = keys.filter(k => !KNOWN_CATEGORIES.includes(k));
    if (unknown.length > 0) {
      recommendations.push(
        `Unknown token categories: ${unknown.map(k => `"${k}"`).join(", ")}. ` +
        `Standard categories are: ${KNOWN_CATEGORIES.join(", ")}.`,
      );
    }
    for (const cat of KNOWN_CATEGORIES) {
      if (!(cat in data)) {
        recommendations.push(`Standard category "${cat}" is missing. Add it if your design system uses ${cat} tokens.`);
      }
    }
    function checkLeaves(obj: unknown, path: string) {
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return;
      const o = obj as Record<string, unknown>;
      const isLeaf = "$value" in o || "$type" in o;
      if (isLeaf) {
        if (!("$value" in o)) errors.push(`Token at "${path}" is missing required property "$value".`);
        if (!("$type" in o))  errors.push(`Token at "${path}" is missing required property "$type".`);
        if ("$value" in o && typeof o.$value !== "string") errors.push(`Token at "${path}".$value must be a string.`);
        if ("$type"  in o && typeof o.$type  !== "string") errors.push(`Token at "${path}".$type must be a string.`);
      } else {
        for (const k of Object.keys(o)) checkLeaves(o[k], `${path}.${k}`);
      }
    }
    for (const cat of keys) checkLeaves(data[cat], cat);
  }

  if (type === "components") {
    const REQUIRED_PROPS = ["name", "description"] as const;
    const keys = Object.keys(data);
    if (keys.length === 0) {
      errors.push("components.json must have at least one component entry.");
    }
    for (const key of keys) {
      const comp = data[key] as Record<string, unknown> | null;
      if (comp === null || typeof comp !== "object" || Array.isArray(comp)) {
        errors.push(`Component "${key}" must be an object.`);
        continue;
      }
      for (const prop of REQUIRED_PROPS) {
        if (!(prop in comp)) errors.push(`Component "${key}" is missing required property "${prop}".`);
        else if (typeof comp[prop] !== "string") errors.push(`Component "${key}".${prop} must be a string.`);
      }
      for (const arr of ["variants", "sizes", "states", "constraints"] as const) {
        if (arr in comp && !Array.isArray(comp[arr])) {
          errors.push(`Component "${key}".${arr} must be an array if present.`);
        }
      }
    }
    if (keys.length > 0 && !("button" in data) && !("input" in data)) {
      recommendations.push(
        'No "button" or "input" component found. Most design systems include these core interactive components.',
      );
    }
  }

  if (type === "themes") {
    const REQUIRED_PROPS = ["name", "description", "semantic"] as const;
    const keys = Object.keys(data);
    if (keys.length === 0) {
      errors.push("themes.json must have at least one theme entry.");
    }
    for (const key of keys) {
      const theme = data[key] as Record<string, unknown> | null;
      if (theme === null || typeof theme !== "object" || Array.isArray(theme)) {
        errors.push(`Theme "${key}" must be an object.`);
        continue;
      }
      for (const prop of REQUIRED_PROPS) {
        if (!(prop in theme)) errors.push(`Theme "${key}" is missing required property "${prop}".`);
      }
      if ("semantic" in theme && (typeof theme.semantic !== "object" || Array.isArray(theme.semantic) || theme.semantic === null)) {
        errors.push(`Theme "${key}".semantic must be an object.`);
      } else if (theme.semantic) {
        for (const [k, v] of Object.entries(theme.semantic as object)) {
          if (typeof v !== "string") {
            errors.push(`Theme "${key}".semantic["${k}"] must be a string value.`);
          }
        }
      }
    }
    if (keys.length > 0 && !("light" in data)) {
      recommendations.push('No "light" theme found. A "light" theme is conventional as the default theme.');
    }
  }

  if (type === "icons") {
    const REQUIRED_PROPS = ["name", "category", "keywords", "sizes", "description"] as const;
    const keys = Object.keys(data);
    if (keys.length === 0) {
      errors.push("icons.json must have at least one icon entry.");
    }
    for (const key of keys) {
      const icon = data[key] as Record<string, unknown> | null;
      if (icon === null || typeof icon !== "object" || Array.isArray(icon)) {
        errors.push(`Icon "${key}" must be an object.`);
        continue;
      }
      for (const prop of REQUIRED_PROPS) {
        if (!(prop in icon)) errors.push(`Icon "${key}" is missing required property "${prop}".`);
      }
      if ("keywords" in icon && !Array.isArray(icon.keywords)) {
        errors.push(`Icon "${key}".keywords must be an array.`);
      }
      if ("sizes" in icon && !Array.isArray(icon.sizes)) {
        errors.push(`Icon "${key}".sizes must be an array of numbers.`);
      } else if ("sizes" in icon && Array.isArray(icon.sizes)) {
        for (const s of icon.sizes as unknown[]) {
          if (typeof s !== "number") {
            errors.push(`Icon "${key}".sizes entries must be numbers (e.g. 16, 24).`);
            break;
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, recommendations };
}

// ── GET /api/data/design-system ───────────────────────────────────────────
// Returns all active data types combined into a single design-system object.
// Used by the Design System Manager download button.
// Must be defined before /data/:type so Express matches it first.
// ─────────────────────────────────────────────────────────────────────────
router.get("/data/design-system", (_req, res) => {
  const result: Partial<Record<DataType, unknown>> = {};
  for (const type of VALID_TYPES) {
    result[type] = getData(type);
  }
  res.json(result);
});

// ── GET /api/data/:type ───────────────────────────────────────────────────
// Returns the currently active data for the given type as JSON.
// Used by the Component Explorer UI to read live design system data.
// ─────────────────────────────────────────────────────────────────────────
router.get("/data/:type", (req, res) => {
  const { type } = req.params;

  if (!VALID_TYPES.includes(type as DataType)) {
    res.status(404).json({
      error: `Unknown type "${type}". Must be one of: ${VALID_TYPES.join(", ")}`,
    });
    return;
  }

  res.json(getData(type as DataType));
});

// ── POST /api/data ────────────────────────────────────────────────────────
// Body: { "type": "tokens"|"components"|"themes"|"icons"|"design-system", "data": <object> }
// Replaces the active data for the given type with the supplied JSON.
// Delegates to the shared ingest service for consistent processing.
// Response includes "loaded", "warnings", and "normalizationSummary" fields.
// ─────────────────────────────────────────────────────────────────────────
router.post("/data", async (req, res) => {
  const { type, data } = req.body as { type?: string; data?: unknown };

  if (!type || (!VALID_TYPES.includes(type as DataType) && type !== "design-system")) {
    res.status(400).json({
      error: `"type" must be one of: ${[...VALID_TYPES, "design-system"].join(", ")}`,
    });
    return;
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    res.status(400).json({ error: '"data" must be a JSON object.' });
    return;
  }

  const result = await ingest("api/data", type as "design-system" | DataType, data as Record<string, unknown>);

  if (!result.ok) {
    res.status(400).json({
      error: result.message,
      // loaded lists any sections that were persisted before the failure so callers
      // know what state the data store is in after a partial ingest.
      loaded: result.loaded,
      errors: result.errors,
      warnings: result.warnings,
    });
    return;
  }

  res.json({
    ok: true,
    type: result.type,
    loaded: result.loaded,
    warnings: result.warnings,
    normalizationSummary: result.normalizationSummary,
    readiness: result.readiness,
    message: result.message,
  });
});

// ── POST /api/data/reset ──────────────────────────────────────────────────
// Body (optional): { "type": "tokens"|"components"|"themes"|"icons" }
// Resets one or all data types back to the bundled on-disk defaults.
// ─────────────────────────────────────────────────────────────────────────
router.post("/data/reset", (req, res) => {
  const { type } = (req.body ?? {}) as { type?: string };

  if (type !== undefined && !VALID_TYPES.includes(type as DataType)) {
    res.status(400).json({
      error: `"type" must be one of: ${VALID_TYPES.join(", ")} (or omit to reset all)`,
    });
    return;
  }

  resetData(type as DataType | undefined);
  const resetTarget = type ?? "all data";
  res.json({ ok: true, type: type ?? "all", message: `${resetTarget} reset to bundled defaults.` });
});

// ── GET /api/schema/:type ─────────────────────────────────────────────────
// Returns the JSON Schema for the given data type as a downloadable file.
// ─────────────────────────────────────────────────────────────────────────
router.get("/schema/:type", (req, res) => {
  const SCHEMA_TYPES = ["tokens", "components", "themes", "icons", "style-guide", "design-system"];
  const { type } = req.params;

  if (!SCHEMA_TYPES.includes(type)) {
    res.status(404).json({ error: `Unknown schema type "${type}". Must be one of: ${SCHEMA_TYPES.join(", ")}` });
    return;
  }

  const schema = DATA_SCHEMAS[type];
  if (!schema) {
    res.status(500).json({ error: `Schema not found for type "${type}".` });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${type}.schema.json"`);
  res.json(schema);
});

// ── POST /api/validate ────────────────────────────────────────────────────
// Body: { "type": "tokens"|...|"design-system", "data": <object> }
// Validates the supplied JSON without loading it.
// Returns { valid, errors, recommendations }.
// ─────────────────────────────────────────────────────────────────────────
router.post("/validate", (req, res) => {
  const { type, data } = req.body as { type?: string; data?: unknown };

  if (!type || (!VALID_TYPES.includes(type as DataType) && type !== "design-system")) {
    res.status(400).json({ error: `"type" must be one of: ${[...VALID_TYPES, "design-system"].join(", ")}` });
    return;
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    res.status(400).json({ error: '"data" must be a JSON object.' });
    return;
  }

  const result = validateAgainstSchema(type as DataType | "design-system", data as Record<string, unknown>);
  res.json(result);
});

export default router;
