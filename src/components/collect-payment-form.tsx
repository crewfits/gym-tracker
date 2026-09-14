"use client";
import { useState } from "react";
import Link from "next/link";
import { PaymentEntries } from "@/components/payment-entries";
import { Feedback } from "@/components/feedback";
import { usePaymentRows } from "@/components/use-payment-rows";
import { usePaymentSubmit } from "@/components/use-payment-submit";
import { paymentRowsErrors, type SplitPaymentResult } from "@/lib/split-payments";
import type { CurrencyCode, StaffHandlerOption } from "@/lib/types";

export function CollectPaymentForm({ memberId, chargeId, balancePaise, today, currencyCode = "INR", handlers = [], defaultHandlerId = "", action }: {
  memberId: string; chargeId: string; balancePaise: number; today: string; currencyCode?: CurrencyCode; handlers?: StaffHandlerOption[]; defaultHandlerId?: string;
  action: (data: FormData) => Promise<SplitPaymentResult>;
}) {
  const { rows, changeRows } = usePaymentRows(balancePaise, today);
  const { submit, pending, error } = usePaymentSubmit(action);
  const [handlerId, setHandlerId] = useState(defaultHandlerId);
  return <form onSubmit={submit} className="form collect-payment-form" aria-busy={pending}>
    <input type="hidden" name="member_id" value={memberId}/>
    <input type="hidden" name="charge_id" value={chargeId}/>
    <Feedback key={error ?? "collection-feedback"} error={error}/>
    {handlers.length > 0 && <div className="field"><label htmlFor="collection-handler">Handled by *</label><select id="collection-handler" name="handled_by_gym_user_id" value={handlerId} onChange={(event) => setHandlerId(event.target.value)} required>{handlers.map((handler) => <option key={handler.id} value={handler.id}>{handler.display_name}</option>)}</select><small>Who is collecting this payment.</small></div>}
    <PaymentEntries rows={rows} onChange={changeRows} balancePaise={balancePaise} today={today} currencyCode={currencyCode} required disabled={pending}/>
    <div className="field"><label htmlFor="collection-notes">Notes (optional)</label><textarea id="collection-notes" name="notes" rows={2} maxLength={2000}/></div>
    <div className="inline-actions"><Link className="button secondary" href={`/members/${memberId}?view=membership`}>Cancel</Link><button type="submit" className="button" disabled={pending || Object.keys(paymentRowsErrors(rows, balancePaise, true)).length > 0}>{pending ? "Recording payments…" : "Record payments & issue receipts"}</button></div>
  </form>;
}
