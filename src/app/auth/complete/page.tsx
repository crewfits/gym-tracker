"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type InvitationSession = { accessToken: string; refreshToken: string };

function invitationSessionFromHash(): InvitationSession | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export default function AuthCompletePage() {
  const [message, setMessage] = useState("Verifying your secure link…");
  const [continueSetup, setContinueSetup] = useState<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } },
    );
    const invitation = invitationSessionFromHash();

    if (!invitation) {
      const timeout = window.setTimeout(() => {
        if (!cancelled) setMessage("This setup link is invalid or has expired. Ask an administrator to send a new invitation.");
      }, 0);
      return () => { cancelled = true; window.clearTimeout(timeout); };
    }
    const validInvitation = invitation;

    async function activateInvitation() {
      const { data, error } = await supabase.auth.setSession({
        access_token: validInvitation.accessToken,
        refresh_token: validInvitation.refreshToken,
      });
      if (cancelled) return;
      if (error || !data.session) {
        setMessage("This setup link is invalid or has expired. Ask an administrator to send a new invitation.");
        return;
      }
      window.history.replaceState(null, "", "/auth/complete");
      window.location.replace("/update-password");
    }

    async function complete() {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error) {
        setMessage("Unable to check the current sign-in session. Please try the link again in a private window.");
        return;
      }
      if (data.session) {
        setMessage("This browser is already signed in. Open the invitation in an incognito/private window to keep that session, or continue to switch this browser to the invited account.");
        setContinueSetup(() => () => { void activateInvitation(); });
        return;
      }
      await activateInvitation();
    }

    void complete();
    return () => { cancelled = true; };
  }, []);

  return <main className="auth-page"><div className="card auth-card"><h1>Setting up your account</h1><p className="muted">{message}</p>{continueSetup && <button className="button" type="button" onClick={continueSetup}>Continue and switch account</button>}</div></main>;
}
