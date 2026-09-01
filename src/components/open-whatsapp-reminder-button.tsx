"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { openWhatsAppReminder } from "@/app/actions/reminders";

type Props = {
  chargeId: string | null;
  kind: "payment" | "renewal";
  memberId: string;
  membershipId: string;
};

export function OpenWhatsAppReminderButton({ chargeId, kind, memberId, membershipId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openReminder() {
    setError(null);
    const popup = window.open("about:blank", "fitkiro-whatsapp-reminder");
    if (!popup) {
      setError("Allow pop-ups for FitKiro, then try again.");
      return;
    }
    popup.opener = null;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("member_id", memberId);
      formData.set("membership_id", membershipId);
      formData.set("charge_id", chargeId ?? "");
      const result = await openWhatsAppReminder(formData);

      if (!result.ok) {
        popup.close();
        setError(result.error);
        return;
      }

      popup.location.href = result.url;
      popup.focus();
    });
  }

  return <div className="button-stack">
    <button className="button small" type="button" onClick={openReminder} disabled={isPending}>
      {isPending ? "Opening..." : <>Open WhatsApp <ExternalLink size={14}/></>}
    </button>
    {error && <small className="form-error">{error}</small>}
  </div>;
}
