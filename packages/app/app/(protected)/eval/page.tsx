import EvalPageClient from "@/components/EvalPageClient";
import { createClient } from "@/lib/supabase/server";

export default async function EvalPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  return <EvalPageClient accessToken={session?.access_token} />;
}
