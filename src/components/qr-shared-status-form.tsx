"use client";

import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/submit-button";

function PendingSharedStatus() {
  const { pending } = useFormStatus();

  return <>
    <span aria-live="polite">{pending ? "Saving shared status…" : "Not marked as shared"}</span>
    <SubmitButton className="button secondary small" pendingLabel="Marking as shared…">Mark as shared</SubmitButton>
  </>;
}

export function QrSharedStatusForm({ action, memberId }: { action: (formData: FormData) => Promise<void>; memberId: string }) {
  return <form action={action} className="qr-share-confirm">
    <input type="hidden" name="member_id" value={memberId}/>
    <PendingSharedStatus/>
  </form>;
}
