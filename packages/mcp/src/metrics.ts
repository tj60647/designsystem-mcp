/**
 * Design System MCP — DB-Backed Metrics
 *
 * Writes events to Neon PostgreSQL and also maintains an in-memory
 * snapshot for the /api/eval/metrics dashboard (fast reads).
 * Falls back gracefully when DATABASE_URL is not configured.
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
}
