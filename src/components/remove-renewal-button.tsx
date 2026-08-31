"use client";

import { Trash2 } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";

export function RemoveRenewalButton({ membershipId, memberId, action }: { membershipId: string; memberId: string; action: (data: FormData) => Promise<void> }) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm("Remove this unpaid renewal? This cannot be undone.")) event.preventDefault(); }}><input type="hidden" name="membership_id" value={membershipId}/><input type="hidden" name="member_id" value={memberId}/><SubmitButton className="button danger small" pendingLabel="Removing…"><Trash2 size={14}/> Remove mistaken renewal</SubmitButton></form>;
}
