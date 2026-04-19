/**
 * Design System MCP — Neon PostgreSQL Client
 *
 * Provides a singleton neon() query helper. Uses @neondatabase/serverless
 * which works in both Node.js long-running servers and Vercel serverless.
 *
 * DATABASE_URL must be set in the environment.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

export function getDb(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is not set.");
    }
    _sql = neon(url);
  }
  return _sql;
}
