import DemoPageClient from "@/components/DemoPageClient";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: { id: string };
}

export default async function DesignSystemDetailPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  return (
    <DemoPageClient
      designSystemId={params.id}
      accessToken={session?.access_token}
    />
  );
}
