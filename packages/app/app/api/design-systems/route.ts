import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";

async function proxy(request: NextRequest, method: string, suffix = "") {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const res = await fetch(`${MCP_URL}/api/design-systems${suffix}`, {
    method,
    headers,
    body: method !== "GET" && method !== "DELETE" ? await request.text() : undefined,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function GET(request: NextRequest) { return proxy(request, "GET"); }
export async function POST(request: NextRequest) { return proxy(request, "POST"); }
