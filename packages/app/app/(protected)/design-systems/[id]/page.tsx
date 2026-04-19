import DemoPageClient from "@/components/DemoPageClient";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignSystemDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  // getUser() validates the JWT with the Supabase Auth server (required for server-side auth).
  // getSession() reads the raw cookie token which we forward to the MCP server.
  await supabase.auth.getUser();
  const { data: { session } } = await supabase.auth.getSession();

  return (
    <DemoPageClient
      designSystemId={id}
      accessToken={session?.access_token}
    />
  );
}
