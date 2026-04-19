"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface Message {
  role: "user" | "assistant";
  content: string;
  preview?: string;
  toolTrace?: string[];
  agent?: string;
}

interface Props {
  designSystemId?: string;
  accessToken?: string;
}

export default function DemoPageClient({ designSystemId, accessToken }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<"chat" | "explorer" | "manager">("chat");
  const [explorerData, setExplorerData] = useState<Record<string, unknown> | null>(null);
  const [explorerType, setExplorerType] = useState<string>("components");
  const [statusText, setStatusText] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadExplorerData(type: string) {
    const mcpUrl = process.env.NEXT_PUBLIC_MCP_SERVER_URL ?? "";
    const url = new URL(`${mcpUrl}/api/data/${type}`);
    if (designSystemId) url.searchParams.set("designSystemId", designSystemId);
    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const res = await fetch(url.toString(), { headers });
    if (res.ok) setExplorerData(await res.json() as Record<string, unknown>);
    setExplorerType(type);
    setActiveSection("explorer");
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    setStatusText("Thinking…");

    const history = messages.map(m => ({ role: m.role, content: m.content }));

    const url = new URL(`${process.env.NEXT_PUBLIC_MCP_SERVER_URL ?? ""}/api/chat`);
    if (designSystemId) url.searchParams.set("designSystemId", designSystemId);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({ message: userMsg, history }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      const toolTrace: string[] = [];
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const evt = JSON.parse(raw) as { type?: string; text?: string; tool?: string; agent?: string; message?: string; preview?: string };
            if (evt.type === "status") setStatusText(evt.text ?? "");
            else if (evt.type === "tool_call") toolTrace.push(`🔧 ${evt.tool ?? ""}`);
            else if (evt.type === "done") {
              setMessages(prev => [...prev, {
                role: "assistant",
                content: evt.message ?? "",
                preview: evt.preview,
                toolTrace: toolTrace.length > 0 ? toolTrace : undefined,
                agent: evt.agent,
              }]);
              setStatusText("");
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${String(err)}` }]);
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 shrink-0">
        <span className="font-bold text-slate-900">Design System AI</span>
        <span className="text-xs bg-brand-600 text-white px-2 py-0.5 rounded-full font-semibold">MCP</span>
        <div className="flex-1" />
        <nav className="flex items-center gap-1">
          {(["chat", "explorer", "manager"] as const).map(s => (
            <button
              key={s}
              onClick={() => setActiveSection(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeSection === s ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
            >
              {s === "chat" ? "Workspace" : s === "explorer" ? "Explorer" : "Manager"}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <button onClick={() => void handleSignOut()} className="btn-ghost text-xs">Sign out</button>
      </header>

      {/* Main content */}
      {activeSection === "chat" && (
        <div className="flex flex-1 min-h-0">
          {/* Chat panel */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-16 text-slate-400">
                  <div className="text-4xl mb-4">🤖</div>
                  <p className="text-sm">Ask about tokens, components, themes, or request code generation.</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${msg.role === "user" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-900"}`}>
                    {msg.agent && <div className="text-xs font-medium text-brand-500 mb-1">🤖 {msg.agent}</div>}
                    {msg.toolTrace && (
                      <div className="mb-2 space-y-0.5">
                        {msg.toolTrace.map((t, j) => (
                          <div key={j} className="text-xs text-slate-400 font-mono">{t}</div>
                        ))}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.preview && (
                      <details className="mt-3">
                        <summary className="text-xs text-slate-400 cursor-pointer">Preview</summary>
                        <iframe
                          srcDoc={msg.preview}
                          className="w-full h-48 mt-2 rounded border border-slate-200"
                          sandbox="allow-same-origin"
                          title="Component preview"
                        />
                      </details>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-400">
                    {statusText || "…"}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-slate-200 bg-white">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your design system…"
                  rows={1}
                  className="input flex-1 resize-none"
                  disabled={loading}
                />
                <button onClick={() => void sendMessage()} disabled={loading || !input.trim()} className="btn-primary px-4">
                  {loading ? "…" : "Send"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {["What color tokens exist?", "Show me button variants", "Build a login form"].map(q => (
                  <button key={q} onClick={() => { setInput(q); }} className="text-xs text-slate-400 hover:text-slate-700 border border-slate-200 rounded-full px-3 py-1 hover:border-slate-400 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSection === "explorer" && (
        <div className="flex-1 overflow-auto p-6">
          <h2 className="text-lg font-semibold mb-4">Component Explorer</h2>
          <div className="flex gap-2 mb-4">
            {["components", "tokens", "themes", "icons"].map(t => (
              <button key={t} onClick={() => void loadExplorerData(t)} className={`btn ${explorerType === t ? "btn-primary" : "btn-secondary"} text-sm`}>{t}</button>
            ))}
          </div>
          {explorerData ? (
            <pre className="bg-white border border-slate-200 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[70vh]">
              {JSON.stringify(explorerData, null, 2)}
            </pre>
          ) : (
            <p className="text-slate-400 text-sm">Click a type above to load data.</p>
          )}
        </div>
      )}

      {activeSection === "manager" && (
        <div className="flex-1 overflow-auto p-6">
          <h2 className="text-lg font-semibold mb-4">Design System Manager</h2>
          <p className="text-slate-500 text-sm">Load custom JSON, generate from a website, or reset to defaults.</p>
        </div>
      )}
    </div>
  );
}
