"use client";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

interface TeamsStatus {
  configured: boolean;
  organizations: Array<{ id: string; name: string }>;
  links: Array<{ id: string; displayName: string; organizationName: string; active: boolean }>;
}

export default function TeamsLinkPage() {
  const { status, data: session } = useSession();
  const [token, setToken] = useState("");
  const [account, setAccount] = useState<TeamsStatus | null>(null);
  const [challenge, setChallenge] = useState<{ displayName: string } | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const callbackUrl = "/auth/teams-link" + (token ? "#" + new URLSearchParams({ token }) : "");

  useEffect(() => { setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") || ""); }, []);
  useEffect(() => {
    if (status !== "authenticated") return;
    let canceled = false;
    setError("");
    setChallenge(null);
    const load = async () => {
      try {
        const response = await fetch("/api/integrations/teams-link", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "Unable to load Teams settings");
        if (canceled) return;
        setAccount(result.data);
        setOrganizationId((current) => result.data.organizations.some((org: { id: string }) => org.id === current) ? current : (result.data.organizations.find((org: { id: string }) => org.id === session?.user.organizationId)?.id || result.data.organizations[0]?.id || ""));
        if (token) {
          const review = await fetch("/api/integrations/teams-link", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", token }),
          });
          const details = await review.json();
          if (!review.ok) throw new Error(details.error?.message || "Unable to review Teams link");
          if (!canceled) setChallenge(details.data);
        }
      } catch (cause) { if (!canceled) setError(cause instanceof Error ? cause.message : "Unable to load Teams settings"); }
    };
    void load();
    return () => { canceled = true; };
  }, [status, token, refresh, session?.user.organizationId]);

  const mutate = async (action: "link" | "unlink", mappingId?: string) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/teams-link", {
        method: action === "link" ? "POST" : "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "link" ? { action, token, organizationId } : { mappingId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Unable to update Teams link");
      setMessage(action === "link" ? "Account linked. Return to your personal Teams chat and send a command." : "Teams account unlinked. It can no longer access this organization.");
      setToken(""); setChallenge(null); setConfirmed(false); setUnlinkId(null);
      window.history.replaceState(null, "", "/auth/teams-link");
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update Teams link"); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen flex items-start justify-center p-6 py-12">
    <Card className="w-full max-w-xl">
      <CardHeader><CardTitle>Teams account</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {status === "loading" && <p role="status">Loading…</p>}
        {status === "unauthenticated" && <>
          <p>Sign in to connect your Teams account with one of your StrengthSync organizations.</p>
          <Button asChild><Link href={"/auth/login?" + new URLSearchParams({ callbackUrl })}>Sign in</Link></Button>
        </>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {message && <p role="status" className="text-green-700 dark:text-green-400">{message}</p>}
        {status === "authenticated" && <>
          <p className="text-sm text-muted-foreground">Signed in as {session?.user.email}</p>
          {!account && !error && <p role="status">Loading Teams settings…</p>}
          {account && !account.configured && <p>Teams account linking is not configured. Your organization administrator can contact the StrengthSync operator to enable it.</p>}
          {account?.configured && challenge && <div className="space-y-4 rounded-lg border p-4">
            <p>Connect <strong>{challenge.displayName}</strong> from your personal Teams chat.</p>
            <p className="text-sm text-muted-foreground">Teams commands will read team strengths and requests, and create shoutouts in the organization you select. Only continue if you requested this link in your own Teams chat.</p>
            <div className="space-y-2">
              <label htmlFor="teams-organization" className="font-medium">Organization</label>
              <select id="teams-organization" value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setConfirmed(false); }} className="w-full rounded-lg border bg-background p-2" disabled={busy}>
                {account.organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
              {account.organizations.length === 0 && <p>You need an active organization membership before linking.</p>}
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} className="mt-1" />I requested this link in my own personal Teams chat.</label>
            <Button onClick={() => mutate("link")} disabled={busy || !confirmed || !organizationId}>{busy ? "Connecting…" : "Connect Teams account"}</Button>
          </div>}
          {account?.configured && !challenge && !token && <p>In a personal chat with the StrengthSync bot, send <strong>/link</strong>. Open the link it sends here to choose an organization. To change organizations, request a new link.</p>}
          {account?.links.map((link) => <div key={link.id} className="space-y-2 rounded-lg border p-4">
            <p className="font-medium">{link.displayName}</p>
            <p>{link.organizationName}</p>
            <p className="text-sm text-muted-foreground">{link.active ? "Connected for personal Teams commands." : "Inactive. Request a new link in Teams after confirming your organization membership."}</p>
            {unlinkId === link.id ? <div className="space-y-2">
              <p>Disconnect this Teams account? You can connect it again with a new link.</p>
              <div className="flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => mutate("unlink", link.id)}>Disconnect</Button><Button variant="outline" disabled={busy} onClick={() => setUnlinkId(null)}>Cancel</Button></div>
            </div> : <Button variant="outline" disabled={busy} onClick={() => setUnlinkId(link.id)}>Disconnect Teams</Button>}
          </div>)}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild><Link href="/settings/profile">Back to profile</Link></Button>
            <Button variant="ghost" disabled={busy} onClick={() => signOut({ callbackUrl })}>Use another account</Button>
          </div>
        </>}
      </CardContent>
    </Card>
  </div>;
}
