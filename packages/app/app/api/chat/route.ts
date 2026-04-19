import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const body = await request.text();
  const { searchParams } = new URL(request.url);
  const designSystemId = searchParams.get("designSystemId");

  const upstreamUrl = new URL(`${MCP_URL}/api/chat`);
  if (designSystemId) upstreamUrl.searchParams.set("designSystemId", designSystemId);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  const upstream = await fetch(upstreamUrl.toString(), {
    method: "POST",
    headers,
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
