/**
 * Design System MCP — Express HTTP Server
 * Author: Thomas J McLeish
 * License: MIT
 */

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import mcpRouter            from "./routes/mcp.js";
import dataRouter           from "./routes/data.js";
import agentRouter          from "./routes/agent.js";
import generateRouter       from "./routes/generate.js";
import chatRouter           from "./routes/chat.js";
import evalRouter           from "./routes/eval.js";
import designSystemsRouter  from "./routes/designSystems.js";
import { authMiddleware }   from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();

app.use(express.json({ limit: "100kb" }));

app.use(express.static(join(__dirname, "../public")));

app.get("/demo", (_req, res) => { res.redirect("/demo.html"); });
app.get("/",     (_req, res) => { res.redirect("/demo"); });
app.get("/eval", (_req, res) => { res.redirect("/eval.html"); });

app.get("/health", (_req, res) => {
  res.json({
    name: "Design System MCP",
    version: "0.4.0",
    status: "running",
    mcpEndpoint: "POST /mcp",
  });
});

// Auth middleware — attaches userId and designSystemId to req for all /api routes
app.use("/api", authMiddleware);

// Route mounts
app.use(mcpRouter);
app.use("/api", dataRouter);
app.use(agentRouter);
app.use("/api", generateRouter);
app.use("/api", chatRouter);
app.use("/api", evalRouter);
app.use("/api", designSystemsRouter);

const isVercel = process.env.VERCEL === "1";

if (!isVercel) {
  const PORT = process.env.PORT ?? "3000";
  app.listen(Number(PORT), () => {
    console.log(`\nDesign System MCP server running on http://localhost:${PORT}`);
  });
}

export default app;
