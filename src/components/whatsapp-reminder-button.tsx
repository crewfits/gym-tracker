"use client";

import { ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";

type ReminderInput = {
  kind: "payment" | "renewal";
  memberId: string;
  membershipId: string;
  chargeId: string;
};

export function WhatsAppReminderButton({ action, input }: { action: (formData: FormData) => Promise<{ url?: string; error?: string }>; input: ReminderInput }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openReminder() {
    setError(null);
    const whatsappTab = window.open("about:blank", "fitkiro-whatsapp-reminder");
    if (!whatsappTab) {
      setError("Allow pop-ups for FitKiro, then try again.");
      return;
    }

    const formData = new FormData();
    formData.set("kind", input.kind);
    formData.set("member_id", input.memberId);
    formData.set("membership_id", input.membershipId);
    formData.set("charge_id", input.chargeId);
    startTransition(async () => {
      const result = await action(formData);
      if (result.url) {
        whatsappTab.location.href = result.url;
        whatsappTab.focus();
        return;
      }
      whatsappTab.close();
      setError(result.error ?? "Could not prepare the WhatsApp reminder.");
    });
  }

  return <div>
    <button className="button small" type="button" disabled={pending} aria-busy={pending} onClick={openReminder}>
      {pending ? "Opening WhatsApp…" : <>Open WhatsApp <ExternalLink size={14}/></>}
    </button>
    {error && <small className="alert error" role="alert">{error}</small>}
  </div>;
}
