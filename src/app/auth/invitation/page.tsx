"use client";

import { Suspense, useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

function Invitation() {
  const token = useSearchParams().get("token") || "";
  const router = useRouter();
  const { status, update } = useSession();
  const [invitation, setInvitation] = useState<{ organizationId: string; organizationName: string; role: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const callbackUrl = "/auth/invitation?" + new URLSearchParams({ token });
  const endpoint = "/api/organizations/invitations?" + new URLSearchParams({ token });

  useEffect(() => {
    if (status !== "authenticated") return;
    let canceled = false;
    setError("");
    fetch(endpoint).then(async (response) => {
      const result = await response.json();
      if (canceled) return;
      if (!response.ok) setError(result.error?.message || "Unable to review invitation");
      else setInvitation(result.data);
    }).catch(() => { if (!canceled) setError("Unable to review invitation. Please try again."); });
    return () => { canceled = true; };
  }, [status, endpoint]);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Unable to accept invitation");
      await update({ organizationId: result.data.organizationId });
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept invitation");
    } finally { setBusy(false); }
  };

  return <div className="min-h-screen flex items-center justify-center p-6">
    <Card className="w-full max-w-md">
      <CardHeader><CardTitle>Organization invitation</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {status === "loading" && <p>Loading invitation…</p>}
        {status === "unauthenticated" && <>
          <p>Sign in with the email address that received this invitation to review and accept it.</p>
          <Button asChild><Link href={"/auth/login?" + new URLSearchParams({ callbackUrl })}>Sign in</Link></Button>
        </>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {status === "authenticated" && invitation && <>
          <p>You are invited to join <strong>{invitation.organizationName}</strong> as a <strong>{invitation.role.toLowerCase()}</strong>.</p>
          <p className="text-sm text-muted-foreground">Accepting shares your account profile with this organization. Your password stays the same.</p>
          <Button onClick={accept} disabled={busy}>{busy ? "Accepting…" : "Accept invitation"}</Button>
        </>}
        {status === "authenticated" && <Button variant="outline" onClick={() => signOut({ callbackUrl })}>Use another account</Button>}
      </CardContent>
    </Card>
  </div>;
}

export default function InvitationPage() {
  return <Suspense fallback={<p className="p-6">Loading invitation…</p>}><Invitation /></Suspense>;
}
