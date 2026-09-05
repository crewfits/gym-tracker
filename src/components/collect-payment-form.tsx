"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { formatInr } from "@/lib/domain";

export function CollectPaymentForm({ memberId, chargeId, balancePaise, today, action }: {
  memberId: string;
  chargeId: string;
  balancePaise: number;
  today: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [amount, setAmount] = useState((balancePaise / 100).toFixed(2));
  const amountPaise = Math.round(Number(amount) * 100);
  const validAmount = amount.trim() !== "" && Number.isFinite(amountPaise) && amountPaise > 0 && amountPaise <= balancePaise;

  return <form action={action} className="form collect-payment-form">
    <input type="hidden" name="member_id" value={memberId}/>
    <input type="hidden" name="charge_id" value={chargeId}/>
    <div className="form-grid">
      <div className="field"><label htmlFor="collection-amount">Amount received (₹) *</label><input id="collection-amount" type="number" name="amount" min="0.01" max={(balancePaise / 100).toFixed(2)} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required/></div>
      <div className="field"><label htmlFor="collection-date">Payment date *</label><input id="collection-date" type="date" name="paid_on" defaultValue={today} required/></div>
      <div className="field"><label htmlFor="collection-method">Payment method *</label><select id="collection-method" name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div>
      <div className="field"><label htmlFor="collection-reference">Reference (optional)</label><input id="collection-reference" name="reference"/></div>
    </div>
    <div className="field"><label htmlFor="collection-notes">Notes (optional)</label><textarea id="collection-notes" name="notes" rows={2}/></div>
    <div className="membership-form-footer">
      <div aria-live="polite"><span className="muted">Balance after this payment</span><strong>{validAmount ? formatInr(balancePaise - amountPaise) : "-"}</strong>{validAmount && amountPaise === balancePaise && <small className="member-balance-settled">Paid in full</small>}</div>
      <div className="inline-actions"><Link className="button secondary" href={`/members/${memberId}?view=membership`}>Cancel</Link><SubmitButton className="button" disabled={!validAmount} pendingLabel="Recording payment..."><CreditCard size={16}/> Record & issue receipt</SubmitButton></div>
    </div>
  </form>;
}
