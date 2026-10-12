"use client";

import { useMemo, useState } from "react";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";
import { usePaymentSubmit } from "@/components/use-payment-submit";
import { calculateCharge, calculateExpiry, formatInr } from "@/lib/domain";
import { type SplitPaymentResult } from "@/lib/split-payments";
import type { CurrencyCode, DurationUnit } from "@/lib/types";

export type MembershipCorrectionPlan = {
  id: string;
  name: string;
  duration_value: number;
  duration_unit: DurationUnit;
  default_fee_paise: number;
  is_active: boolean;
};

type Props = {
  action: (formData: FormData) => Promise<SplitPaymentResult>;
  memberId: string;
  membershipId: string;
  currentPlanId: string | null;
  startsOn: string;
  expiresOn: string;
  subtotalPaise: number;
  discountPaise: number;
  gstRateBasisPoints: number;
  paidPaise: number;
  today: string;
  plans: MembershipCorrectionPlan[];
  currencyCode: CurrencyCode;
};

function moneyInput(paise: number) {
  return (paise / 100).toFixed(2);
}

export function correctionValuesForPlan(plan: MembershipCorrectionPlan, startsOn: string) {
  return {
    subtotal: moneyInput(Number(plan.default_fee_paise)),
    expiresOn: calculateExpiry(startsOn, plan.duration_value, plan.duration_unit),
  };
}

export function MembershipCorrectionForm({
  action,
  memberId,
  membershipId,
  currentPlanId,
  startsOn: initialStartsOn,
  expiresOn: initialExpiresOn,
  subtotalPaise,
  discountPaise,
  gstRateBasisPoints,
  paidPaise,
  today,
  plans,
  currencyCode,
}: Props) {
  const initialPlan = plans.find((plan) => plan.id === currentPlanId) ?? plans[0];
  const [planId, setPlanId] = useState(initialPlan?.id ?? "");
  const [startsOn, setStartsOn] = useState(initialStartsOn);
  const [expiresOn, setExpiresOn] = useState(initialExpiresOn);
  const [subtotal, setSubtotal] = useState(moneyInput(subtotalPaise));
  const [discount, setDiscount] = useState(moneyInput(discountPaise));
  const [gstRate, setGstRate] = useState((gstRateBasisPoints / 100).toString());
  const [amountPaid, setAmountPaid] = useState(moneyInput(paidPaise));
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const correctedTotal = useMemo(() => {
    try {
      return calculateCharge(
        Math.max(0, Math.round((Number(subtotal) || 0) * 100)),
        Math.max(0, Math.round((Number(discount) || 0) * 100)),
        Math.max(0, Math.round((Number(gstRate) || 0) * 100)),
      ).totalPaise;
    } catch {
      return null;
    }
  }, [discount, gstRate, subtotal]);
  const amountPaidPaise = Math.max(0, Math.round((Number(amountPaid) || 0) * 100));
  const outstandingPaise = Math.max(0, (correctedTotal ?? 0) - amountPaidPaise);
  const newCollectionPaise = Math.max(0, amountPaidPaise - paidPaise);
  const amountError = correctedTotal !== null && amountPaidPaise > correctedTotal ? "Amount paid cannot exceed the plan total." : "";
  const { submit, pending, error } = usePaymentSubmit(action);

  function clampAmountPaid(nextSubtotal: string, nextDiscount: string, nextGstRate: string) {
    try {
      const nextTotal = calculateCharge(
        Math.max(0, Math.round((Number(nextSubtotal) || 0) * 100)),
        Math.max(0, Math.round((Number(nextDiscount) || 0) * 100)),
        Math.max(0, Math.round((Number(nextGstRate) || 0) * 100)),
      ).totalPaise;
      setAmountPaid((current) => moneyInput(Math.min(Math.max(0, Math.round((Number(current) || 0) * 100)), nextTotal)));
    } catch {
      // Keep the owner's input in place until the charge fields are valid again.
    }
  }

  function selectPlan(nextPlanId: string) {
    setPlanId(nextPlanId);
    const plan = plans.find((item) => item.id === nextPlanId);
    if (!plan || !startsOn) return;
    const next = correctionValuesForPlan(plan, startsOn);
    setSubtotal(next.subtotal);
    setExpiresOn(next.expiresOn);
    clampAmountPaid(next.subtotal, discount, gstRate);
  }

  function changeStartDate(nextStart: string) {
    setStartsOn(nextStart);
    if (selectedPlan && nextStart) {
      setExpiresOn(calculateExpiry(nextStart, selectedPlan.duration_value, selectedPlan.duration_unit));
    }
  }

  return <form onSubmit={submit} className="membership-correction-form">
    <input type="hidden" name="member_id" value={memberId}/>
    <input type="hidden" name="membership_id" value={membershipId}/>
    <div className="membership-correction-head">
      <span className="eyebrow">Owner correction</span>
      <p className="muted">Choose the intended plan to update its standard price and calculate the membership end date. You can still correct a genuine discount, tax, or custom date before saving.</p>
    </div>
    <div className="membership-correction-grid">
      <label>Plan
        <select name="plan_id" value={planId} onChange={(event) => selectPlan(event.target.value)} required>
          {!planId && <option value="">Choose plan</option>}
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatInr(Number(plan.default_fee_paise), currencyCode)}{plan.is_active ? "" : " (archived)"}</option>)}
        </select>
      </label>
      <label>Start date <input type="date" name="starts_on" value={startsOn} onChange={(event) => changeStartDate(event.target.value)} required/></label>
      <label>End date <input type="date" name="expires_on" value={expiresOn} min={startsOn} onChange={(event) => setExpiresOn(event.target.value)} required/></label>
      <label>Plan price <input name="subtotal" inputMode="decimal" value={subtotal} onChange={(event) => { setSubtotal(event.target.value); clampAmountPaid(event.target.value, discount, gstRate); }} required/></label>
      <label>Discount <input name="discount" inputMode="decimal" value={discount} onChange={(event) => { setDiscount(event.target.value); clampAmountPaid(subtotal, event.target.value, gstRate); }} required/></label>
      <label>GST % <input name="gst_rate" inputMode="decimal" value={gstRate} onChange={(event) => { setGstRate(event.target.value); clampAmountPaid(subtotal, discount, event.target.value); }} required/></label>
    </div>
    <fieldset className="membership-correction-payment">
      <legend>Payment</legend>
      <p className="muted">Enter the total amount paid for this membership after the correction. Any unpaid amount will remain outstanding.</p>
      <div className="membership-correction-payment-grid">
        <label>Amount paid ({currencyCode}) <input name="amount_paid" inputMode="decimal" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} required/>{amountError && <small className="field-error">{amountError}</small>}</label>
        {newCollectionPaise > 0 && <>
          <label>Method <select name="method" defaultValue="cash" required><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></label>
          <label>Payment date <input type="date" name="paid_on" defaultValue={today} required/></label>
          <label>Reference (optional) <input name="reference" maxLength={200}/></label>
        </>}
      </div>
      <p className={outstandingPaise > 0 ? "membership-correction-outstanding is-due" : "membership-correction-outstanding is-settled"}><span>{outstandingPaise > 0 ? "Outstanding after correction" : "Payment status"}</span><strong>{outstandingPaise > 0 ? formatInr(outstandingPaise, currencyCode) : "Fully paid"}</strong></p>
    </fieldset>
    <label className="membership-correction-reason">Correction reason
      <textarea name="reason" rows={2} maxLength={240} placeholder="Example: Wrong plan selected during activation" required/>
    </label>
    <Feedback error={error}/>
    <SubmitButton className="button secondary small" disabled={pending || !planId || correctedTotal === null || !startsOn || !expiresOn || expiresOn < startsOn || Boolean(amountError)}>{pending ? "Correcting..." : "Save correction"}</SubmitButton>
  </form>;
}
