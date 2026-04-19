"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/demo";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const supabase = createClient();

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push(redirectTo);
    }
  }

  async function handleMagicLink() {
    if (!email) { setError("Enter your email address first."); return; }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${redirectTo}` },
    });
    if (error) { setError(error.message); setLoading(false); }
    else { setMagicLinkSent(true); setLoading(false); }
  }

  async function handleOAuth(provider: "github" | "google") {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?redirectTo=${redirectTo}` },
    });
  }

  if (magicLinkSent) {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">📧</div>
        <h2 className="text-xl font-semibold mb-2">Check your email</h2>
        <p className="text-slate-500 text-sm">We sent a magic link to <strong>{email}</strong>.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleEmailSignIn} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
        <input className="input w-full" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
        <input className="input w-full" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? "Signing in…" : "Sign in"}</button>
      <button type="button" onClick={handleMagicLink} disabled={loading} className="btn-secondary w-full">Send magic link</button>
      <div className="relative my-2"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div><div className="relative flex justify-center text-xs text-slate-400 bg-white px-2">or</div></div>
      <button type="button" onClick={() => handleOAuth("github")} disabled={loading} className="btn-secondary w-full flex items-center gap-2"><span>🐙</span> Continue with GitHub</button>
      <button type="button" onClick={() => handleOAuth("google")} disabled={loading} className="btn-secondary w-full flex items-center gap-2"><span>G</span> Continue with Google</button>
      <p className="text-center text-sm text-slate-500">No account? <Link href="/auth/sign-up" className="text-brand-600 hover:underline">Sign up</Link></p>
    </form>
  );
}

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-slate-500 text-sm mt-1">to Design System AI</p>
        </div>
        <Suspense>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
