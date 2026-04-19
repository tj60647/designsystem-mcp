import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";

/**
 * Ensures a newly authenticated user has at least one design system.
 * Creates a default "My Design System" row via the MCP server if the user
 * has none.  Idempotent: if the user already has design systems, this is a
 * no-op.  Errors are swallowed so that the auth callback never fails due to
 * seeding issues.
 */
async function ensureDefaultDesignSystem(accessToken: string): Promise<void> {
  try {
    const authHeader = `Bearer ${accessToken}`;
    const listRes = await fetch(`${MCP_URL}/api/design-systems`, {
      headers: { Authorization: authHeader },
    });
    if (!listRes.ok) return;

    const body = await listRes.json() as { designSystems?: { id: string }[] };
    const designSystems = body.designSystems ?? [];

    if (designSystems.length === 0) {
      await fetch(`${MCP_URL}/api/design-systems`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "My Design System" }),
      });
    }
  } catch {
    // Non-fatal: the user can create a design system manually from the dashboard
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") ?? "/demo";
  const next = redirectTo.startsWith("/") ? redirectTo : "/demo";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Seed a default design system for first-time users (idempotent)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await ensureDefaultDesignSystem(session.access_token);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth-callback-error`);
}
