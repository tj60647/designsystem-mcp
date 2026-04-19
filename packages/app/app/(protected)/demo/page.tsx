import DemoPageClient from "@/components/DemoPageClient";
import { createClient } from "@/lib/supabase/server";

export default async function DemoPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  return (
    <DemoPageClient
      designSystemId={undefined}
      accessToken={session?.access_token}
    />
  );
}
