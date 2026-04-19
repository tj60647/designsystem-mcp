"use client";

import { useState, useEffect } from "react";

interface MetricsData {
  requests: number;
  cacheHits: number;
  routing: Record<string, number>;
  toolCalls: Record<string, number>;
  resetAt: string;
}

interface Props {
  accessToken?: string;
}

export default function EvalPageClient({ accessToken }: Props) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [judgePrompt, setJudgePrompt] = useState("");
  const [judgeResponse, setJudgeResponse] = useState("");
  const [judgeResult, setJudgeResult] = useState<{ score: number; reasoning: string } | null>(null);
  const [judgeLoading, setJudgeLoading] = useState(false);

  async function loadMetrics() {
    setLoading(true);
    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const res = await fetch("/api/eval/metrics", { headers });
    if (res.ok) setMetrics(await res.json() as MetricsData);
    setLoading(false);
  }

  async function resetMetrics() {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    await fetch("/api/eval/metrics/reset", { method: "POST", headers });
    void loadMetrics();
  }

  async function runJudge() {
    if (!judgePrompt || !judgeResponse) return;
    setJudgeLoading(true);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const res = await fetch("/api/eval/judge", {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: judgePrompt, response: judgeResponse }),
    });
    if (res.ok) setJudgeResult(await res.json() as { score: number; reasoning: string });
    setJudgeLoading(false);
  }

  useEffect(() => { void loadMetrics(); }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-2xl font-bold">Eval Lab</h1>
        <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded-full font-semibold">EVAL</span>
      </div>

      {/* Metrics */}
      <section className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Usage Metrics</h2>
          <div className="flex gap-2">
            <button onClick={() => void loadMetrics()} className="btn-secondary text-sm">Refresh</button>
            <button onClick={() => void resetMetrics()} className="btn-ghost text-sm text-red-600">Reset</button>
          </div>
        </div>
        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : metrics ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-brand-600">{metrics.requests}</div>
              <div className="text-xs text-slate-500 mt-1">Total requests</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{metrics.cacheHits}</div>
              <div className="text-xs text-slate-500 mt-1">Cache hits</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">{Object.values(metrics.routing).reduce((a, b) => a + b, 0)}</div>
              <div className="text-xs text-slate-500 mt-1">Agent routes</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">{Object.values(metrics.toolCalls).reduce((a, b) => a + b, 0)}</div>
              <div className="text-xs text-slate-500 mt-1">Tool calls</div>
            </div>
          </div>
        ) : null}
        {metrics && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">Agent Routing</h3>
              {Object.entries(metrics.routing).length === 0 ? (
                <p className="text-xs text-slate-400">No routing data yet.</p>
              ) : (
                Object.entries(metrics.routing).map(([agent, count]) => (
                  <div key={agent} className="flex justify-between text-sm py-1 border-b border-slate-100">
                    <span className="text-slate-600">{agent}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">Top Tool Calls</h3>
              {Object.entries(metrics.toolCalls).length === 0 ? (
                <p className="text-xs text-slate-400">No tool calls yet.</p>
              ) : (
                Object.entries(metrics.toolCalls)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 8)
                  .map(([tool, count]) => (
                    <div key={tool} className="flex justify-between text-sm py-1 border-b border-slate-100">
                      <span className="text-slate-600 font-mono text-xs">{tool}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </section>

      {/* LLM Judge */}
      <section className="card p-6">
        <h2 className="font-semibold mb-4">LLM Judge</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">User Prompt</label>
            <textarea value={judgePrompt} onChange={e => setJudgePrompt(e.target.value)} rows={3} className="input w-full" placeholder="What color tokens are available?" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Assistant Response</label>
            <textarea value={judgeResponse} onChange={e => setJudgeResponse(e.target.value)} rows={5} className="input w-full" placeholder="The design system includes primary, secondary, neutral…" />
          </div>
          <button onClick={() => void runJudge()} disabled={judgeLoading || !judgePrompt || !judgeResponse} className="btn-primary">
            {judgeLoading ? "Evaluating…" : "Evaluate"}
          </button>
          {judgeResult && (
            <div className="bg-slate-50 rounded-lg p-4 mt-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl font-bold text-brand-600">{judgeResult.score}/10</span>
                <div className="flex-1 bg-slate-200 rounded-full h-2">
                  <div className="bg-brand-500 h-2 rounded-full" style={{ width: `${judgeResult.score * 10}%` }} />
                </div>
              </div>
              <p className="text-sm text-slate-600">{judgeResult.reasoning}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
