"use client";

import { formatInr } from "@/lib/domain";

export function ReversePaymentForm({ paymentId, memberId, remainingPaise, action }: { paymentId: string; memberId: string; remainingPaise: number; action: (data: FormData) => Promise<void> }) {
  return <details className="reverse-disclosure"><summary>Reverse payment</summary><form className="reverse-form" action={action} onSubmit={(event) => { if (!window.confirm("Reverse this payment? It will stop counting toward collections and balance, but the original receipt will remain in history.")) event.preventDefault(); }}>
    <input type="hidden" name="payment_id" value={paymentId}/><input type="hidden" name="member_id" value={memberId}/>
    <label>Amount to reverse</label><input className="search" type="number" name="amount" min="0.01" max={(remainingPaise / 100).toFixed(2)} step="0.01" defaultValue={(remainingPaise / 100).toFixed(2)} required/><small className="muted">Up to {formatInr(remainingPaise)} remaining.</small>
    <input className="search" name="reason" required placeholder="Why is this being reversed?"/>
    <div className="reverse-actions"><button className="button danger small">Confirm reversal</button><button className="button secondary small" type="button" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>Cancel</button></div>
  </form></details>;
}
