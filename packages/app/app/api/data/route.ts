import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";

async function proxyToMcp(request: NextRequest, method: string) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const url = new URL(request.url);
  const upstreamUrl = new URL(`${MCP_URL}/api/data${url.pathname.replace("/api/data", "")}${url.search}`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const res = await fetch(upstreamUrl.toString(), {
    method,
    headers,
    body: method !== "GET" ? await request.text() : undefined,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function GET(request: NextRequest) { return proxyToMcp(request, "GET"); }
export async function POST(request: NextRequest) { return proxyToMcp(request, "POST"); }
