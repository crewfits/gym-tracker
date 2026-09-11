"use client";

import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";

export function ConfirmActionForm({
  action,
  memberId,
  message,
  className,
  disabled,
  label,
  icon,
  pendingLabel = "Working…",
}: {
  action: (formData: FormData) => Promise<void>;
  memberId: string;
  message: string;
  className?: string;
  disabled?: boolean;
  label: string;
  icon?: ReactNode;
  pendingLabel?: string;
}) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>
    <input type="hidden" name="member_id" value={memberId}/>
    <SubmitButton className={className} disabled={disabled} title={icon ? label : undefined} aria-label={icon ? label : undefined} pendingLabel={icon ? "..." : pendingLabel}>{icon ?? label}</SubmitButton>
  </form>;
}
