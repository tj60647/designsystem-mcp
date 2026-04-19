/**
 * Design System MCP — Design Systems Management Routes
 *
 * Routes:
 *   GET    /api/design-systems       — list user's design systems
 *   POST   /api/design-systems       — create a new design system
 *   DELETE /api/design-systems/:id   — delete a design system
 */

import express from "express";
import { getDb } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ── GET /api/design-systems ───────────────────────────────────────────────
router.get("/design-systems", requireAuth, async (req, res) => {
  const userId = req.userId ?? "anonymous";
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, name, created_at, updated_at
      FROM design_systems
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    res.json({ designSystems: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/design-systems ──────────────────────────────────────────────
router.post("/design-systems", requireAuth, async (req, res) => {
  const userId = req.userId ?? "anonymous";
  const { name } = req.body as { name?: string };

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: '"name" is required.' });
    return;
  }

  try {
    const sql = getDb();
    // Ensure the user row exists
    await sql`
      INSERT INTO users (id) VALUES (${userId})
      ON CONFLICT (id) DO NOTHING
    `;
    const rows = await sql`
      INSERT INTO design_systems (user_id, name)
      VALUES (${userId}, ${name.trim()})
      RETURNING id, name, created_at, updated_at
    `;
    res.status(201).json({ designSystem: rows[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/design-systems/:id ────────────────────────────────────────
router.delete("/design-systems/:id", requireAuth, async (req, res) => {
  const userId = req.userId ?? "anonymous";
  const { id } = req.params;

  try {
    const sql = getDb();
    const result = await sql`
      DELETE FROM design_systems
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `;
    if (result.length === 0) {
      res.status(404).json({ error: "Design system not found." });
      return;
    }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
