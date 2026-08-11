import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";

type AuthorizationDetails = {
  client?: { name?: string | null } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scope?: string | null;
};

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

const oauth = () => (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;

/**
 * OAuth 2.1 consent screen (routed at /.lovable/oauth/consent).
 *
 * Supabase Auth is the authorization server; it redirects the user here with
 * an `authorization_id` so they can approve or deny an MCP client (Claude,
 * ChatGPT, Cursor, …) acting on their behalf against this app's MCP server.
 */
export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id in the URL.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error: detailsError } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error: decisionError } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (decisionError) {
      setBusy(false);
      setError(decisionError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/20 to-background p-4">
      <Card className="w-full max-w-md">
        {error ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl">Authorization failed</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Close this window and start the connection again from the client app.
              </p>
            </CardContent>
          </>
        ) : !details ? (
          <CardContent className="flex items-center gap-3 py-10 justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading authorization request…</span>
          </CardContent>
        ) : (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <CardTitle className="text-xl">
                Connect {details.client?.name ?? "an app"} to your account
              </CardTitle>
              <CardDescription>
                It will be able to read your subscribers, subscriptions, devices, packs and payment
                ledger as you. Only approve clients you trust.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full" disabled={busy} onClick={() => decide(true)}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Approve
              </Button>
              <Button variant="outline" className="w-full" disabled={busy} onClick={() => decide(false)}>
                Deny
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
