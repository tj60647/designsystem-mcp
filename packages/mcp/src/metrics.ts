/**
 * Design System MCP — DB-Backed Metrics
 *
 * Writes events to Neon PostgreSQL and also maintains an in-memory
 * snapshot for the /api/eval/metrics dashboard (fast reads).
 * Falls back gracefully when DATABASE_URL is not configured.
 *
 * On server startup, call initMetricsFromDb() to restore the in-memory
 * counters from the DB so that metrics survive process restarts.
 * resetMetrics() clears the in-memory state and writes a "reset" event to
 * the DB so that subsequent startups begin counting from that point.
 */

import { getDb } from "./db/client.js";

export interface MetricsSnapshot {
  requests:   number;
  cacheHits:  number;
  routing:    Record<string, number>;
  toolCalls:  Record<string, number>;
  resetAt:    string;
}

// In-memory counters for fast dashboard reads
const state = {
  requests:  0,
  cacheHits: 0,
  routing:   {} as Record<string, number>,
  toolCalls: {} as Record<string, number>,
  resetAt:   new Date().toISOString(),
};

async function persistEvent(
  userId: string | null,
  designSystemId: string | null,
  eventType: string,
  eventKey: string | null,
): Promise<void> {
  try {
    const sql = getDb();
    await sql`
      INSERT INTO metrics (user_id, design_system_id, event_type, event_key)
      VALUES (
        ${userId ?? "anonymous"},
        ${designSystemId},
        ${eventType},
        ${eventKey}
      )
    `;
  } catch {
    // Silently swallow DB errors — metrics must never break the main path
  }
}

/**
 * Load aggregate metric counts from the DB and populate the in-memory state.
 * Should be called once at server startup.  If the DB is unavailable the
 * in-memory state stays at zero (graceful degradation).
 */
export async function initMetricsFromDb(): Promise<void> {
  try {
    const sql = getDb();

    // Find the most recent reset event so we only aggregate since then
    const resetRows = await sql`
      SELECT created_at FROM metrics
      WHERE event_type = 'reset'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const since: string | null = resetRows.length > 0
      ? (resetRows[0].created_at as string)
      : null;

    // Aggregate counts since the last reset (or all-time if no reset recorded)
    const rows = since
      ? await sql`
          SELECT event_type, event_key, COUNT(*)::int AS cnt
          FROM metrics
          WHERE event_type IN ('request', 'cache_hit', 'routing', 'tool_call')
            AND created_at > ${since}
          GROUP BY event_type, event_key
        `
      : await sql`
          SELECT event_type, event_key, COUNT(*)::int AS cnt
          FROM metrics
          WHERE event_type IN ('request', 'cache_hit', 'routing', 'tool_call')
          GROUP BY event_type, event_key
        `;

    let requests  = 0;
    let cacheHits = 0;
    const routing:   Record<string, number> = {};
    const toolCalls: Record<string, number> = {};

    for (const row of rows) {
      const { event_type, event_key, cnt } = row as {
        event_type: string;
        event_key:  string | null;
        cnt:        number;
      };
      if (event_type === "request")   requests  += cnt;
      if (event_type === "cache_hit") cacheHits += cnt;
      if (event_type === "routing"   && event_key) routing[event_key]   = (routing[event_key]   ?? 0) + cnt;
      if (event_type === "tool_call" && event_key) toolCalls[event_key] = (toolCalls[event_key] ?? 0) + cnt;
    }

    state.requests  = requests;
    state.cacheHits = cacheHits;
    state.routing   = routing;
    state.toolCalls = toolCalls;
    state.resetAt   = since ?? new Date(0).toISOString();
  } catch {
    // DB unavailable — metrics start from zero, which is the existing behaviour
  }
}

export function recordRequest(userId?: string, designSystemId?: string): void {
  state.requests++;
  void persistEvent(userId ?? null, designSystemId ?? null, "request", null);
}

export function recordCacheHit(userId?: string, designSystemId?: string): void {
  state.cacheHits++;
  void persistEvent(userId ?? null, designSystemId ?? null, "cache_hit", null);
}

export function recordRouting(agent: string, userId?: string, designSystemId?: string): void {
  state.routing[agent] = (state.routing[agent] ?? 0) + 1;
  void persistEvent(userId ?? null, designSystemId ?? null, "routing", agent);
}

export function recordToolCall(tool: string, userId?: string, designSystemId?: string): void {
  state.toolCalls[tool] = (state.toolCalls[tool] ?? 0) + 1;
  void persistEvent(userId ?? null, designSystemId ?? null, "tool_call", tool);
}

export function getMetrics(): MetricsSnapshot {
  return {
    requests:  state.requests,
    cacheHits: state.cacheHits,
    routing:   { ...state.routing },
    toolCalls: { ...state.toolCalls },
    resetAt:   state.resetAt,
  };
}

export function resetMetrics(): void {
  state.requests  = 0;
  state.cacheHits = 0;
  state.routing   = {};
  state.toolCalls = {};
  state.resetAt   = new Date().toISOString();
  // Persist a reset boundary event so subsequent startups count from here
  void persistEvent(null, null, "reset", null);
}
