"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Logo } from "@/components/brand/Logo";

function VerifyEmailForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const invitation = params.get("invitation") || undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acceptInvitation, setAcceptInvitation] = useState(false);
  const [context, setContext] = useState<{ email: string; organizationName?: string; role?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [message, setMessage] = useState(token ? "" : "Check your inbox and spam folder for the setup link. You will choose your password after opening it.");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ token, ...(invitation ? { invitation } : {}) });
    fetch(`/api/auth/verify-email?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw Error(result.error?.message || "Unable to verify this link"); setContext(result.data); setEmail(result.data.email); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message || "Unable to verify this link"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, invitation]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (context && (password !== confirmation || password.length < 8 || new TextEncoder().encode(password).length > 72)) {
      setError("Use matching passwords of at least 8 characters, within 72 UTF-8 bytes."); return;
    }
    setBusy(true);
    try {
      const response = await fetch(context ? "/api/auth/verify-email" : "/api/auth/resend-verification", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(context ? { token, invitation, password, acceptInvitation } : { email }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error?.message || "Unable to complete this request");
      setMessage(result.data.message); if (context) setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to complete this request"); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen flex items-center justify-center p-4 mesh-gradient"><div className="w-full max-w-md space-y-6">
    <div className="flex justify-center"><Logo size="lg" showText /></div>
    <Card><CardHeader><CardTitle>{done ? "Your account is ready" : "Verify your email"}</CardTitle>
      <CardDescription>{context ? `Choose your own password for ${context.email}.` : "Finish setting up your StrengthSync account."}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {loading && <p role="status">Checking your link…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        {!loading && !done && <form onSubmit={submit} className="space-y-4">
          {context ? <>
            <div className="space-y-2"><label htmlFor="setup-password">New password</label><Input id="setup-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={event => setPassword(event.target.value)} /><p className="text-xs text-muted-foreground">At least 8 characters, within 72 UTF-8 bytes. Symbols and spaces are allowed.</p></div>
            <div className="space-y-2"><label htmlFor="setup-confirmation">Confirm password</label><Input id="setup-confirmation" type="password" autoComplete="new-password" maxLength={72} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
            {context.organizationName && <label className="flex gap-3 text-sm"><input type="checkbox" required checked={acceptInvitation} onChange={event => setAcceptInvitation(event.target.checked)} /><span>I accept the invitation to join {context.organizationName} as {context.role?.toLowerCase()}.</span></label>}
          </> : <div className="space-y-2"><label htmlFor="verification-email">Email address</label><Input id="verification-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} /></div>}
          <Button type="submit" className="w-full" isLoading={busy}>{context ? context.organizationName ? "Verify email and join" : "Verify email and save password" : "Send verification email"}</Button>
        </form>}
        <Link href="/auth/login" className="block text-center text-sm underline">Back to sign in</Link>
      </CardContent></Card>
  </div></main>;
}
export default function VerifyEmailPage() { return <Suspense fallback={<p>Loading account setup…</p>}><VerifyEmailForm /></Suspense>; }
