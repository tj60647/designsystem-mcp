import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const headers: Record<string, string> = {};
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const url = new URL(request.url);
  const suffix = url.pathname.replace("/api/eval", "");
  const res = await fetch(`${MCP_URL}/api/eval${suffix}${url.search}`, { headers });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const url = new URL(request.url);
  const suffix = url.pathname.replace("/api/eval", "");
  const body = await request.text();
  const res = await fetch(`${MCP_URL}/api/eval${suffix}`, { method: "POST", headers, body });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
