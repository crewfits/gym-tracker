"use client";

import { RotateCcw } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";

export function RemoveRenewalButton({ membershipId, memberId, action }: { membershipId: string; memberId: string; action: (data: FormData) => Promise<void> }) {
  return <form className="mistaken-renewal-form" action={action} onClick={(event) => event.stopPropagation()} onSubmit={(event) => {
    if (!window.confirm("Revert this mistaken renewal? Any recorded payment for this renewal will be fully reversed and kept in the audit history.")) event.preventDefault();
  }}>
    <input type="hidden" name="membership_id" value={membershipId}/>
    <input type="hidden" name="member_id" value={memberId}/>
    <SubmitButton className="button danger small" pendingLabel="Reverting..."><RotateCcw size={14}/> Revert mistaken renewal</SubmitButton>
  </form>;
}
