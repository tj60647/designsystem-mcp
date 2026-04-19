/**
 * Design System MCP — API Smoke Tests
 *
 * Basic smoke-tests for the Express HTTP server.
 * Run with:  pnpm --filter @designsystem-mcp/mcp test:api
 *
 * The tests start the Express app in-process on a random port so that no
 * external DATABASE_URL or SUPABASE_JWT_SECRET is required.  The server
 * falls back to the in-memory data store automatically when those env-vars
 * are absent.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import type { AddressInfo } from "node:net";

// Prevent dotenv from loading real credentials from a local .env file
process.env.DATABASE_URL        = "";
process.env.SUPABASE_JWT_SECRET = "";

const { default: app } = await import("../src/index.js");

let baseUrl: string;
const server = app.listen(0);

before(async () => {
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

// ── Helpers ───────────────────────────────────────────────────────────────

function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Health ────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status running", async () => {
    const res = await get("/health");
    assert.equal(res.status, 200);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(json.status, "running");
    assert.equal(typeof json.version, "string");
  });
});

// ── Data — read ───────────────────────────────────────────────────────────

describe("GET /api/data/:type", () => {
  for (const type of ["tokens", "components", "themes", "icons", "style-guide"]) {
    it(`returns 200 for type=${type}`, async () => {
      const res = await get(`/api/data/${type}`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(typeof json, "object");
      assert.notEqual(json, null);
    });
  }

  it("returns 404 for an unknown type", async () => {
    const res = await get("/api/data/unknown-type");
    assert.equal(res.status, 404);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(typeof json.error, "string");
  });
});

describe("GET /api/data/design-system", () => {
  it("returns an object containing all standard sections", async () => {
    const res = await get("/api/data/design-system");
    assert.equal(res.status, 200);
    const json = await res.json() as Record<string, unknown>;
    for (const section of ["tokens", "components", "themes", "icons", "style-guide"]) {
      assert.ok(section in json, `missing section: ${section}`);
    }
  });
});

// ── Data — write + round-trip ─────────────────────────────────────────────

describe("POST /api/data", () => {
  it("accepts valid tokens and returns ok:true", async () => {
    const res = await post("/api/data", {
      type: "tokens",
      data: {
        color: {
          primary: { $value: "#2563eb", $type: "color" },
        },
      },
    });
    assert.equal(res.status, 200);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.loaded));
    assert.ok((json.loaded as string[]).includes("tokens"));
  });

  it("returns 400 when type is missing", async () => {
    const res = await post("/api/data", { data: {} });
    assert.equal(res.status, 400);
  });

  it("returns 400 when data is an array", async () => {
    const res = await post("/api/data", { type: "tokens", data: [] });
    assert.equal(res.status, 400);
  });
});

// ── Validate ──────────────────────────────────────────────────────────────

describe("POST /api/validate", () => {
  it("returns valid:true for a well-formed tokens object", async () => {
    const res = await post("/api/validate", {
      type: "tokens",
      data: {
        color: {
          primary: { $value: "#2563eb", $type: "color" },
        },
      },
    });
    assert.equal(res.status, 200);
    const json = await res.json() as { valid: boolean };
    assert.equal(json.valid, true);
  });

  it("returns 400 when type is missing", async () => {
    const res = await post("/api/validate", { data: {} });
    assert.equal(res.status, 400);
  });

  it("returns valid:false for an empty tokens object", async () => {
    const res = await post("/api/validate", { type: "tokens", data: {} });
    assert.equal(res.status, 200);
    const json = await res.json() as { valid: boolean; errors: string[] };
    assert.equal(json.valid, false);
    assert.ok(json.errors.length > 0);
  });
});

// ── Schema ────────────────────────────────────────────────────────────────

describe("GET /api/schema/:type", () => {
  it("returns a schema object for tokens", async () => {
    const res = await get("/api/schema/tokens");
    assert.equal(res.status, 200);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(typeof json, "object");
    assert.notEqual(json, null);
  });

  it("returns 404 for an unknown schema type", async () => {
    const res = await get("/api/schema/bogus");
    assert.equal(res.status, 404);
  });
});

// ── Metrics ───────────────────────────────────────────────────────────────

describe("GET /api/eval/metrics", () => {
  it("returns a metrics snapshot with expected keys", async () => {
    const res = await get("/api/eval/metrics");
    assert.equal(res.status, 200);
    const json = await res.json() as Record<string, unknown>;
    for (const key of ["requests", "cacheHits", "routing", "toolCalls", "resetAt"]) {
      assert.ok(key in json, `missing key: ${key}`);
    }
  });
});

describe("POST /api/eval/metrics/reset", () => {
  it("resets metrics and returns ok:true", async () => {
    const res = await post("/api/eval/metrics/reset", {});
    assert.equal(res.status, 200);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(json.ok, true);
    assert.equal(typeof json.resetAt, "string");
  });
});
