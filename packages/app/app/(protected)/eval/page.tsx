import EvalPageClient from "@/components/EvalPageClient";
import { createClient } from "@/lib/supabase/server";

export default async function EvalPage() {
  const supabase = await createClient();
  // getUser() validates the JWT with the Supabase Auth server (required for server-side auth).
  // getSession() reads the raw cookie token which we forward to the MCP server.
  await supabase.auth.getUser();
  const { data: { session } } = await supabase.auth.getSession();

  return <EvalPageClient accessToken={session?.access_token} />;
}
