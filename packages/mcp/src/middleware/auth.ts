/**
 * Design System MCP — Auth Middleware
 *
 * Validates the Authorization: Bearer <jwt> header using the Supabase
 * JWT secret. Extracts userId (the JWT sub claim) and attaches it to
 * req for downstream route handlers.
 *
 * Set SUPABASE_JWT_SECRET in the environment. If it is not set the
 * middleware passes through (development mode — all users are anonymous).
 */

import type { Request, Response, NextFunction } from "express";
import { createSecretKey } from "crypto";
import { jwtVerify } from "jose";

// Extend Express Request to carry the authenticated user id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      designSystemId?: string;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  // Attach designSystemId from query param for all requests
  req.designSystemId = typeof req.query.designSystemId === "string"
    ? req.query.designSystemId
    : undefined;

  if (!jwtSecret) {
    // No secret configured → dev mode, anonymous access
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header missing or invalid." });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const secret = createSecretKey(Buffer.from(jwtSecret, "utf-8"));
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    req.userId = typeof payload.sub === "string" ? payload.sub : undefined;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

/**
 * requireAuth — stricter version that returns 401 if userId is not set.
 * Use on write endpoints (POST /api/data, POST /api/data/reset, etc.)
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.userId && process.env.SUPABASE_JWT_SECRET) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}
