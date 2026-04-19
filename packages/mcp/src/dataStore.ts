/**
 * Design System MCP — DB-Backed Data Store
 *
 * Same interface as the original in-memory dataStore but persists to
 * Neon PostgreSQL. The bundled JSON files serve as seed data when a
 * user/design-system row has no data yet.
 *
 * getData / setData / resetData accept optional (userId, designSystemId)
 * for multi-tenant scoping. When called without these (e.g. from the
 * legacy single-tenant codepath) they fall back to the in-memory store
 * so all existing tool code works unchanged.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getDb } from "./db/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export type DataType = "tokens" | "components" | "themes" | "icons" | "changelog" | "deprecations" | "style-guide";

const DATA_TYPES: DataType[] = ["tokens", "components", "themes", "icons", "changelog", "deprecations", "style-guide"];

const ALLOWED_DATA_FILES = new Set([
  "tokens.json", "components.json", "themes.json", "icons.json",
  "changelog.json", "deprecations.json", "style-guide.json",
]);

function loadJson(filename: string): unknown {
  if (!ALLOWED_DATA_FILES.has(filename)) {
    throw new Error(`Disallowed data file: "${filename}"`);
  }
  return JSON.parse(readFileSync(join(__dirname, "data", filename), "utf-8"));
}

// In-memory fallback store (used when no userId/designSystemId is provided,
// keeping full backward compatibility with legacy tool routes).
const fallbackStore: Record<DataType, unknown> = {
  tokens:        loadJson("tokens.json"),
  components:    loadJson("components.json"),
  themes:        loadJson("themes.json"),
  icons:         loadJson("icons.json"),
  changelog:     loadJson("changelog.json"),
  deprecations:  loadJson("deprecations.json"),
  "style-guide": loadJson("style-guide.json"),
};

// ── Scoped (DB-backed) accessors ──────────────────────────────────────────

export async function getScopedData(
  userId: string,
  designSystemId: string,
  type: DataType,
): Promise<unknown> {
  const sql = getDb();
  const rows = await sql`
    SELECT data FROM design_system_data
    WHERE design_system_id = ${designSystemId}
      AND user_id           = ${userId}
      AND data_type         = ${type}
    LIMIT 1
  `;
  if (rows.length > 0) return rows[0].data;
  // Seed from bundled JSON on first read
  return loadJson(`${type}.json`);
}

export async function setScopedData(
  userId: string,
  designSystemId: string,
  type: DataType,
  data: unknown,
): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO design_system_data (design_system_id, user_id, data_type, data)
    VALUES (${designSystemId}, ${userId}, ${type}, ${JSON.stringify(data)})
    ON CONFLICT (design_system_id, data_type)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

export async function resetScopedData(
  userId: string,
  designSystemId: string,
  type?: DataType,
): Promise<void> {
  const sql = getDb();
  const types = type ? [type] : DATA_TYPES;
  for (const t of types) {
    const seed = loadJson(`${t}.json`);
    await sql`
      INSERT INTO design_system_data (design_system_id, user_id, data_type, data)
      VALUES (${designSystemId}, ${userId}, ${t}, ${JSON.stringify(seed)})
      ON CONFLICT (design_system_id, data_type)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `;
  }
}

// ── Legacy (in-memory) accessors — backward-compatible ───────────────────

export function getData(type: DataType): unknown {
  return fallbackStore[type];
}

export function setData(type: DataType, data: unknown): void {
  fallbackStore[type] = data;
}

export function resetData(type?: DataType): void {
  if (type) {
    fallbackStore[type] = loadJson(`${type}.json`);
  } else {
    for (const t of DATA_TYPES) {
      fallbackStore[t] = loadJson(`${t}.json`);
    }
  }
}
