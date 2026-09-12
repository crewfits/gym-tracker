"use client";

import { formatInr } from "@/lib/domain";
import { SubmitButton } from "@/components/submit-button";
import type { CurrencyCode } from "@/lib/types";

export function ReversePaymentForm({ paymentId, memberId, remainingPaise, currencyCode = "INR", action }: { paymentId: string; memberId: string; remainingPaise: number; currencyCode?: CurrencyCode; action: (data: FormData) => Promise<void> }) {
  return <details className="reverse-disclosure"><summary>Reverse payment</summary><form className="reverse-form" action={action} onSubmit={(event) => { if (!window.confirm("Reverse this payment? It will stop counting toward collections and balance, but the original receipt will remain in history.")) event.preventDefault(); }}>
    <input type="hidden" name="payment_id" value={paymentId}/><input type="hidden" name="member_id" value={memberId}/>
    <label>Amount to reverse</label><input className="search" type="number" name="amount" min="0.01" max={(remainingPaise / 100).toFixed(2)} step="0.01" defaultValue={(remainingPaise / 100).toFixed(2)} required/><small className="muted">Up to {formatInr(remainingPaise, currencyCode)} remaining.</small>
    <input className="search" name="reason" required placeholder="Why is this being reversed?"/>
    <div className="reverse-actions"><SubmitButton className="button danger small" pendingLabel="Reversing…">Confirm reversal</SubmitButton><button className="button secondary small" type="button" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>Cancel</button></div>
  </form></details>;
}
