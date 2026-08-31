"use client";

import { SubmitButton } from "@/components/submit-button";

export function ConfirmActionForm({
  action,
  memberId,
  message,
  className,
  disabled,
  label,
  pendingLabel = "Working…",
}: {
  action: (formData: FormData) => Promise<void>;
  memberId: string;
  message: string;
  className?: string;
  disabled?: boolean;
  label: string;
  pendingLabel?: string;
}) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>
    <input type="hidden" name="member_id" value={memberId}/>
    <SubmitButton className={className} disabled={disabled} pendingLabel={pendingLabel}>{label}</SubmitButton>
  </form>;
}
