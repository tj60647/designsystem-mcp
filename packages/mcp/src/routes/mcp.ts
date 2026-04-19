/**
 * Design System MCP — MCP Route
 * Author: Thomas J McLeish
 * License: MIT
 *
 * Handles POST /mcp — the Model Context Protocol JSON-RPC endpoint.
 *
 * Each request is fully stateless: a fresh McpServer and transport are
 * created per request, the tool call is processed, then the transport is
 * closed.  This pattern works with both long-running servers (Heroku) and
 * serverless functions (Vercel).
 */

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../mcp-server.js";

const router = express.Router();

// ── MCP endpoint ──────────────────────────────────────────────────────────
// AI clients (Claude Desktop, GitHub Copilot, etc.) send their JSON-RPC
// tool-call requests here as HTTP POST.
//
// Steps per request:
//   1. Create a fresh McpServer with all tools registered.
//   2. Create a StreamableHTTPServerTransport in stateless mode
//      (sessionIdGenerator: undefined means no persistent sessions).
//   3. Hand the request body to the transport; it routes the call to the
//      correct tool and writes the JSON result back to the client.
//   4. Close the transport on response finish to avoid memory leaks.
// ─────────────────────────────────────────────────────────────────────────
router.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("finish", () => {
      transport.close().catch((err: unknown) => {
        console.error("Transport close error:", err);
      });
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
