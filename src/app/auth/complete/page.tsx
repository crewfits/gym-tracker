"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ArrowRight, Dumbbell, ShieldCheck } from "lucide-react";

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
        setMessage("We could not check this browser session. Ask an administrator to send a fresh invitation link.");
        return;
      }
      if (data.session) {
        setMessage("This browser is already signed in. This secure link has now been opened and cannot be copied to another browser. Continue here to set up the invited account.");
        setContinueSetup(() => () => { void activateInvitation(); });
        return;
      }
      await activateInvitation();
    }

    void complete();
    return () => { cancelled = true; };
  }, []);

  return <main className="auth-complete-page">
    <section className="auth-complete-card">
      <div className="auth-complete-brand"><span className="brand-mark"><Dumbbell size={21}/></span><strong>FitKiro</strong></div>
      <div className="auth-complete-icon"><ShieldCheck size={28}/></div>
      <p className="eyebrow">Secure account setup</p>
      <h1>{continueSetup ? "Finish setting up your account" : "Verifying your invitation"}</h1>
      <p className="muted">{message}</p>
      {continueSetup && <>
        <button className="button auth-complete-button" type="button" onClick={continueSetup}>Set up account in this browser <ArrowRight size={18}/></button>
        <p className="auth-complete-help">To keep another account signed in, ask an administrator to send a fresh invitation and open that new link in a private window first.</p>
      </>}
      {!continueSetup && message !== "Verifying your secure link…" && <p className="auth-complete-help">Invitation links are single-use for your security.</p>}
    </section>
  </main>;
}
