import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const body = await request.text();
  const res = await fetch(`${MCP_URL}/api/generate-from-website`, {
    method: "POST",
    headers,
    body,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
