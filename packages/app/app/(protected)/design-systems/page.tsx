import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

async function getDesignSystems(accessToken: string) {
  const mcpUrl = process.env.MCP_SERVER_URL ?? "http://localhost:3000";
  const res = await fetch(`${mcpUrl}/api/design-systems`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json() as { designSystems: { id: string; name: string; created_at: string }[] };
  return data.designSystems ?? [];
}

export default async function DesignSystemsPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const designSystems = session?.access_token
    ? await getDesignSystems(session.access_token)
    : [];

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Your Design Systems</h1>
        <Link href="/demo" className="btn-primary">+ New</Link>
      </div>

      {designSystems.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4">🎨</div>
          <h2 className="text-lg font-semibold mb-2">No design systems yet</h2>
          <p className="text-slate-500 text-sm mb-6">Create your first design system to get started.</p>
          <Link href="/demo" className="btn-primary">Open Demo</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {designSystems.map((ds) => (
            <Link
              key={ds.id}
              href={`/design-systems/${ds.id}`}
              className="card p-6 hover:border-brand-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{ds.name}</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(ds.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-slate-300">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
