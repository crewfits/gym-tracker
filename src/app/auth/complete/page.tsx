"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function AuthCompletePage() {
  const [message, setMessage] = useState("Verifying your secure link…");

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    async function complete() {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error || !data.session) {
        setMessage("This setup link is invalid or has expired. Ask an administrator to send a new invitation.");
        return;
      }
      window.location.replace("/update-password");
    }

    void complete();
    return () => { cancelled = true; };
  }, []);

  return <main className="auth-page"><div className="card auth-card"><h1>Setting up your account</h1><p className="muted">{message}</p></div></main>;
}
