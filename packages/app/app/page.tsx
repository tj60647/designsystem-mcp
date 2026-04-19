import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">Design System AI</span>
          <span className="text-xs bg-brand-600 text-white px-2 py-0.5 rounded-full font-semibold">MCP</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white transition-colors text-sm">
            Sign in
          </Link>
          <Link href="/auth/sign-up" className="btn-primary text-sm px-4 py-2 rounded-md">
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <h1 className="text-5xl font-bold mb-6 leading-tight">
          Make your design system{" "}
          <span className="text-brand-400">AI-native</span>
        </h1>
        <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
          Query tokens, components, themes, and icons through a Model Context Protocol (MCP) server.
          Connect to Claude, GitHub Copilot, and any AI that speaks MCP.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="btn-primary text-base px-6 py-3 rounded-lg">
            Start for free
          </Link>
          <Link href="/demo" className="btn-secondary text-base px-6 py-3 rounded-lg bg-white/10 border-white/20 text-white hover:bg-white/20">
            Try the demo
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-20 grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            icon: "🤖",
            title: "28 MCP Tools",
            desc: "Query tokens, components, themes, icons, accessibility checks, and more — all via standard MCP.",
          },
          {
            icon: "🔐",
            title: "Auth + Multi-tenancy",
            desc: "Sign in with GitHub or Google. Each user gets their own isolated design system data.",
          },
          {
            icon: "⚡",
            title: "AI Chat Interface",
            desc: "Five specialized AI agents (reader, builder, generator, style-guide, orchestrator) with live tool traces.",
          },
        ].map((f) => (
          <div key={f.title} className="card bg-white/5 border-white/10 p-6 rounded-xl">
            <div className="text-3xl mb-4">{f.icon}</div>
            <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="text-center py-12 text-slate-500 text-sm">
        <p>Design System AI · Built with MCP · <a href="https://github.com/tj60647/designsystem-mcp" className="hover:text-slate-300 underline">GitHub</a></p>
      </footer>
    </main>
  );
}
