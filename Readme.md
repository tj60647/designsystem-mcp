# Design System MCP

Make your design system **AI-native**. Design System MCP exposes your tokens, components, themes, and icons through a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server so that any AI assistant that speaks MCP — Claude Desktop, GitHub Copilot, Cursor, and others — can query, reason about, and generate code grounded in your actual design system data.

---

## Goals

| Goal | Description |
|---|---|
| **MCP-first design system API** | Expose every design system artifact (tokens, components, themes, icons, style guide, changelog, deprecations) as MCP tools, resources, and prompts that AI agents can call directly. |
| **Multi-tenant & persistent** | Each authenticated user gets their own isolated design system data stored in PostgreSQL. Data survives server restarts and scales to many users. |
| **AI chat interface** | A web UI with five specialized AI agents (Orchestrator, Reader, Component Builder, System Generator, Style Guide) that demonstrate the MCP tools in a chat-driven workflow. |
| **Standards-based auth** | Supabase Auth (GitHub OAuth, Google OAuth, email magic link) protecting the web app, with JWT-validated API middleware on the MCP server. |
| **Independently deployable packages** | The MCP HTTP server and the Next.js web app are separate packages that can be deployed to different hosts (e.g. MCP server on Railway, web app on Vercel). |

---

## Repository Structure

```
designsystem-mcp/
├── packages/
│   ├── mcp/          — Express HTTP server: MCP JSON-RPC endpoint + REST data APIs
│   └── app/          — Next.js web app: demo UI, auth, API proxy routes
├── package.json      — pnpm workspace root
├── turbo.json        — Turborepo build pipeline
├── tsconfig.base.json — Shared TypeScript config (ESM, strict, ES2022)
└── pnpm-workspace.yaml
```

Both packages are TypeScript ESM, built with `tsc`, orchestrated via [Turborepo](https://turbo.build/).

---

## Architecture

### packages/mcp — MCP HTTP Server

A standalone Express HTTP server. Stateless per-request MCP pattern (no persistent sessions) works for both long-running servers and Vercel serverless functions.

```
packages/mcp/src/
├── index.ts              — Express app, route mounts, server startup
├── mcp-server.ts         — McpServer with all 27 tools, 14 resources, 10 prompts
├── agentConfig.ts        — OpenRouter tool definitions for the 5 AI agents
├── toolRunner.ts         — Tool invocation logic
├── generator.ts          — Design system code generation
├── ingestService.ts      — Data ingestion + normalization pipeline
├── websiteExtractor.ts   — Website content extraction
├── playwrightExtractor.ts — Playwright-based component extraction
├── dataStore.ts          — DB-backed data store (Neon PostgreSQL) with in-memory fallback
├── metrics.ts            — DB-backed event metrics with in-memory snapshot for fast reads
├── schemas.ts            — JSON Schemas for all data types
├── db/
│   └── client.ts         — Neon PostgreSQL singleton client
├── middleware/
│   └── auth.ts           — JWT auth middleware (Supabase JWT secret via jose)
├── routes/
│   ├── mcp.ts            — POST /mcp  (MCP JSON-RPC endpoint)
│   ├── data.ts           — GET/POST /api/data, GET /api/schema, POST /api/validate
│   ├── designSystems.ts  — GET/POST/DELETE /api/design-systems
│   ├── chat.ts           — POST /api/chat  (AI agent chat)
│   ├── agent.ts          — Agent info + routing
│   ├── generate.ts       — POST /api/generate-from-website
│   └── eval.ts           — GET/POST /api/eval/metrics
└── data/
    ├── tokens.json        — Bundled seed tokens
    ├── components.json    — Bundled seed components
    ├── themes.json        — Bundled seed themes
    ├── icons.json         — Bundled seed icons
    ├── style-guide.json   — Bundled seed style guide
    ├── changelog.json     — Bundled seed changelog
    └── deprecations.json  — Bundled seed deprecations
```

**MCP primitives registered**

| Type | Count | Description |
|---|---|---|
| Tools | 27 | Executable functions: token queries, component lookups, a11y checks, icon search, theme resolving, generate_design_system, and more |
| Resources | 14 | Read-only reference documents (full tokens, component catalog, themes, icons, style-guide, schemas, changelog, deprecations, …) |
| Prompts | 10 | Reusable parameterized LLM templates (component audit, token usage, theme documentation, migration guide, …) |

**Data store**

`dataStore.ts` provides two access layers that share a common interface:

- **Scoped (DB-backed):** `getScopedData / setScopedData / resetScopedData` — reads/writes to Neon PostgreSQL, scoped to `(userId, designSystemId)`. On first read the bundled JSON is used as seed data.
- **Legacy (in-memory):** `getData / setData / resetData` — original single-tenant in-memory fallback, used automatically when no auth context is present (e.g. local dev without a database).

All existing tool code calls the legacy accessors unchanged; the scoped path is taken by REST API routes when a valid JWT and `designSystemId` query param are present.

**Auth middleware**

`middleware/auth.ts` runs on all `/api` routes:
- Reads `Authorization: Bearer <jwt>` and verifies with `SUPABASE_JWT_SECRET` (via `jose`).
- Extracts `sub` as `userId` and attaches it to `req`.
- Reads `?designSystemId=` query param and attaches it to `req`.
- If `SUPABASE_JWT_SECRET` is not set, passes through with no userId (development mode).
- `requireAuth` is a stricter helper used on write routes to explicitly enforce authentication.

**Metrics**

`metrics.ts` is event-sourced: each `recordRequest / recordCacheHit / recordRouting / recordToolCall` call inserts a row into the `metrics` table in Neon, and also increments an in-memory snapshot for fast dashboard reads. On startup, `initMetricsFromDb()` rebuilds the in-memory counters from the database since the last reset event.

---

### packages/app — Next.js Web App

A Next.js 15 (App Router) frontend. Provides auth, the demo chat UI, the Eval Lab, and a design systems dashboard.

```
packages/app/
├── middleware.ts          — Supabase SSR session check, redirects unauthenticated users
├── app/
│   ├── page.tsx           — Landing / marketing page
│   ├── layout.tsx         — Root layout
│   ├── globals.css        — Tailwind base styles
│   ├── auth/
│   │   ├── sign-in/       — Sign-in page
│   │   ├── sign-up/       — Sign-up page
│   │   └── callback/      — Supabase OAuth callback route
│   ├── (protected)/       — Auth-gated routes
│   │   ├── demo/          — Split-panel AI chat + Component Explorer
│   │   ├── eval/          — Eval Lab (metrics dashboard)
│   │   ├── design-systems/ — Design systems dashboard
│   │   └── layout.tsx     — Shared protected layout
│   └── api/               — Next.js Route Handlers (proxy to MCP server)
│       ├── chat/          — Forward to /api/chat
│       ├── data/          — Forward to /api/data
│       ├── eval/          — Forward to /api/eval/metrics
│       ├── design-systems/ — Forward to /api/design-systems
│       └── generate-from-website/ — Forward to /api/generate-from-website
├── components/            — Shared React components
└── lib/
    └── supabase/
        ├── client.ts      — Browser Supabase client
        └── server.ts      — Server-side Supabase client (SSR)
```

**Auth** is handled by `@supabase/ssr`:
- `middleware.ts` runs on every request, refreshes the Supabase session cookie, and redirects unauthenticated users away from `/demo`, `/eval`, and `/design-systems/*` to `/auth/sign-in`.
- Auth pages live under `app/auth/` and use the Supabase JS client directly.
- The OAuth callback is handled at `app/auth/callback/route.ts`.

**API proxy routes** inject the user's JWT (from the Supabase session) into the `Authorization` header before forwarding each request to the MCP server. This keeps auth logic out of client-side code.

---

## Data Flow

### End-to-end request (authenticated user, AI tool call)

```
Browser / AI Client
  │
  │ POST /mcp  (JSON-RPC tool call, e.g. get_tokens)
  ▼
packages/mcp — Express server
  │
  ├── authMiddleware   — verifies JWT, attaches userId + designSystemId to req
  │
  ├── routes/mcp.ts   — creates fresh McpServer + StreamableHTTPServerTransport
  │                     (stateless per-request pattern)
  │
  ├── mcp-server.ts   — routes the JSON-RPC call to the correct tool handler
  │
  └── dataStore.ts    — getScopedData(userId, designSystemId, type)
        │
        └── db/client.ts  — queries Neon PostgreSQL
              SELECT data FROM design_system_data
              WHERE design_system_id = ? AND user_id = ? AND data_type = ?
              → returns JSONB; falls back to bundled seed JSON on first access
```

### Auth flow (web app user)

```
1. User visits app.yourdomain.com
2. Middleware checks Supabase session cookie
3. If no session → redirect to /auth/sign-in
4. User signs in (GitHub OAuth / Google OAuth / email magic link)
5. Supabase sets HttpOnly session cookie; middleware allows through
6. On first sign-in → Supabase webhook / server action creates users row
   and a default design_systems row pre-seeded with bundled JSON
7. Browser fetches data via Next.js API proxy routes
8. Proxy routes read the JWT from the Supabase session and forward:
     Authorization: Bearer <supabase_jwt>
   to the MCP server
9. MCP server validates JWT with SUPABASE_JWT_SECRET, extracts userId,
   scopes all data reads/writes to that userId
```

### AI chat flow

```
User types a message in /demo
  │
  ▼
app/api/chat/route.ts  — proxies to MCP server with auth header
  │
  ▼
routes/chat.ts  — Orchestrator agent classifies intent,
                  delegates to one of five specialists:
                  • Design System Reader  (token/component Q&A)
                  • Component Builder    (grounded HTML/CSS generation)
                  • System Generator     (gathers brand requirements)
                  • Style Guide          (design principles, patterns)
                  • Orchestrator         (fallback, clarification)
  │
  ▼
agentConfig.ts  — OpenRouter function-calling loop
                  Each specialist has access to the MCP tools
                  expressed as OpenAI function definitions
  │
  ▼
toolRunner.ts   — Executes the selected tool, reads from dataStore
  │
  ▼
Streamed response returned to the UI with tool call traces
```

---

## PostgreSQL Schema

```sql
-- Users (synced from Supabase auth.users on first sign-in)
CREATE TABLE users (
  id         UUID PRIMARY KEY,  -- = Supabase auth.users.id
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Named design systems per user
CREATE TABLE design_systems (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Per-section JSONB storage (replaces in-memory dataStore)
CREATE TABLE design_system_data (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id UUID NOT NULL REFERENCES design_systems(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL,
  data_type        TEXT NOT NULL,   -- tokens | components | themes | icons | style-guide | ...
  data             JSONB NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (design_system_id, user_id, data_type)
);

-- Event-sourced metrics (replaces in-memory metrics.ts)
CREATE TABLE metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT,
  design_system_id UUID,
  event_type       TEXT NOT NULL,  -- request | cache_hit | routing | tool_call | reset
  event_key        TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

New users' first design system is pre-seeded from the bundled JSON files in `packages/mcp/src/data/`. All data reads fall back to those same files when no database row exists yet.

---

## Turborepo Pipeline

```json
{
  "pipeline": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev":       { "cache": false, "persistent": true },
    "typecheck": { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["build"] },
    "test:api":  { "dependsOn": ["build"] }
  }
}
```

- `turbo dev` — starts both packages concurrently
- `turbo build` — builds `packages/mcp` (tsc) first, then `packages/app` (next build)
- `turbo typecheck` — type-checks both packages

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10
- A [Neon](https://neon.tech) PostgreSQL project
- A [Supabase](https://supabase.com) project (for auth)
- An [OpenRouter](https://openrouter.ai) API key (for AI chat)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

**packages/mcp/.env** (copy from `.env.example`):

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=openai/gpt-oss-20b:nitro
PORT=3000
```

**packages/app/.env.local** (copy from `.env.example`):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:3000
MCP_SERVER_URL=http://localhost:3000
OPENROUTER_API_KEY=your_openrouter_key_here
```

### 3. Run the database migrations

Run the SQL in [PostgreSQL Schema](#postgresql-schema) against your Neon project. The bundled JSON seed data is loaded automatically on first user access — no separate seed script is required.

### 4. Start development

```bash
pnpm dev        # starts both packages via turbo
```

Or start individually:

```bash
pnpm --filter @designsystem-mcp/mcp dev    # MCP server on :3000
pnpm --filter @designsystem-mcp/app dev    # Next.js app on :3001 (default Next.js port)
```

### 5. Connect an AI client

Point your MCP-compatible AI client at `http://localhost:3000/mcp`.

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "design-system": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

---

## API Reference

### MCP endpoint

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp` | MCP JSON-RPC endpoint. Send tool calls, resource reads, prompt requests. |
| `GET` | `/health` | Server health check. |

### Data REST API

All routes require `Authorization: Bearer <jwt>` when `SUPABASE_JWT_SECRET` is set. Pass `?designSystemId=<uuid>` to scope to a specific design system.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/data/:type` | Get active data (`tokens`, `components`, `themes`, `icons`, `style-guide`). |
| `GET` | `/api/data/design-system` | Get all data types combined as a single object. |
| `POST` | `/api/data` | Replace active data. Body: `{ type, data }`. |
| `POST` | `/api/data/reset` | Reset to bundled defaults. Body: `{ type? }`. |
| `GET` | `/api/schema/:type` | Download JSON Schema for a data type. |
| `POST` | `/api/validate` | Validate JSON without loading it. Body: `{ type, data }`. |

### Design systems

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/design-systems` | List user's design systems. |
| `POST` | `/api/design-systems` | Create a design system. Body: `{ name }`. |
| `DELETE` | `/api/design-systems/:id` | Delete a design system. |

### AI chat & generation

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | Chat with an AI agent. Body: `{ messages, agent? }`. |
| `POST` | `/api/generate-from-website` | Generate a design system from a URL. Body: `{ url }`. |
| `GET` | `/api/eval/metrics` | Get current metrics snapshot. |
| `POST` | `/api/eval/metrics/reset` | Reset metrics counters. |

---

## Deployment

### packages/mcp → Vercel (or Railway / Render)

A `vercel.json` is included in `packages/mcp`. The stateless per-request McpServer pattern is serverless-compatible.

```bash
cd packages/mcp
vercel deploy
```

Set the environment variables (`DATABASE_URL`, `SUPABASE_JWT_SECRET`, `OPENROUTER_API_KEY`) in the Vercel project settings.

### packages/app → Vercel

```bash
cd packages/app
vercel deploy
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_MCP_SERVER_URL` (pointing to the deployed MCP server URL).

---

## Testing

```bash
pnpm --filter @designsystem-mcp/mcp test:api
```

Smoke tests start the Express server in-process on a random port without requiring a real database or JWT secret (falls back to in-memory mode automatically).

---

## License

MIT — Thomas J McLeish
