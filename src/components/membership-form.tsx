"use client";

import { useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/types";
import { calculateExpiry, calculatePaymentFollowUpDate, calculateRenewalStart, formatDisplayDate, formatInr } from "@/lib/domain";
import { SubmitButton } from "@/components/submit-button";

function planEndDate(plan: Plan | undefined, startDate: string) {
  return plan && startDate ? calculateExpiry(startDate, plan.duration_value, plan.duration_unit) : "";
}
function toPaise(value: string) { return Math.max(0, Math.round((Number(value) || 0) * 100)); }

export function MembershipForm({ memberId, plans, action, today, renew = false, embedded = false, currentExpiry, defaultPlanId, error, returnPath }: { memberId: string; plans: Plan[]; action: (data: FormData) => void | Promise<void>; today: string; renew?: boolean; embedded?: boolean; currentExpiry?: string; defaultPlanId?: string | null; error?: string; returnPath?: string }) {
  const initialPlan = plans.find((plan) => plan.id === defaultPlanId) ?? plans[0];
  const [planId, setPlanId] = useState(initialPlan?.id ?? "");
  const [subtotal, setSubtotal] = useState(initialPlan ? (initialPlan.default_fee_paise / 100).toFixed(2) : "0.00");
  const [discount, setDiscount] = useState("0");
  const [gstRate, setGstRate] = useState("0");
  const [startDate, setStartDate] = useState(today);
  const effectiveStartDate = startDate ? renew ? calculateRenewalStart(currentExpiry ?? null, startDate) : startDate : "";
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const [endDate, setEndDate] = useState(planEndDate(selectedPlan, effectiveStartDate));
  const followUpDate = effectiveStartDate ? calculatePaymentFollowUpDate(effectiveStartDate) : today;
  const total = Math.max(0, Number(subtotal || 0) - Number(discount || 0)) * (1 + Number(gstRate || 0) / 100);
  const totalAmount = total.toFixed(2);
  const [amountPaid, setAmountPaid] = useState(totalAmount);
  const paidInFull = useRef(true);

  useEffect(() => {
    if (!renew) return;
    const totalPaise = toPaise(totalAmount);
    const paidPaise = toPaise(amountPaid);
    if (paidInFull.current || paidPaise > totalPaise) setAmountPaid(totalAmount);
  }, [amountPaid, renew, totalAmount]);

  function selectPlan(id: string) {
    setPlanId(id);
    const plan = plans.find((item) => item.id === id);
    if (plan) {
      setSubtotal((plan.default_fee_paise / 100).toFixed(2));
      setEndDate(planEndDate(plan, effectiveStartDate));
    }
  }

  function changeStartDate(value: string) {
    setStartDate(value);
    const nextStart = value ? renew ? calculateRenewalStart(currentExpiry ?? null, value) : value : "";
    setEndDate(planEndDate(selectedPlan, nextStart));
  }

  function changeAmountPaid(value: string) {
    const totalPaise = toPaise(totalAmount);
    const enteredPaise = toPaise(value);
    const nextPaid = Math.min(enteredPaise, totalPaise);
    paidInFull.current = nextPaid >= totalPaise;
    setAmountPaid(enteredPaise > totalPaise ? totalAmount : value);
  }

  return <form action={action} className={embedded ? "form member-renewal-form" : "card form"} style={embedded ? undefined : { maxWidth: 800 }} onInvalid={(event) => {
    const disclosure = (event.target as HTMLElement).closest("details");
    if (disclosure) disclosure.open = true;
  }}>
    <input type="hidden" name="member_id" value={memberId}/>
    {returnPath && <input type="hidden" name="return_path" value={returnPath}/>}
    <input type="hidden" name="due_on" value={followUpDate}/>
    {error && <div className="alert error">{error}</div>}
    <div className="form-grid">
      <div className="field"><label htmlFor="membership-plan">Plan *</label><select id="membership-plan" name="plan_id" value={planId} onChange={(event) => selectPlan(event.target.value)} required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_value} {plan.duration_unit}</option>)}</select></div>
      <div className="field"><label htmlFor="membership-price">Plan price (₹) *</label><input id="membership-price" type="number" name="subtotal" min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required/></div>
      <div className="field"><label htmlFor="membership-start">{renew ? "Renewal date" : "Start date"} *</label><input id="membership-start" type="date" name={renew ? "renewal_date" : "starts_on"} value={startDate} onChange={(event) => changeStartDate(event.target.value)} required/>{renew && effectiveStartDate !== startDate && <small>Membership starts {formatDisplayDate(effectiveStartDate)} after the current plan ends.</small>}</div>
      <div className="field"><label htmlFor="membership-end">Plan end date *</label><input id="membership-end" type="date" name="expires_on" min={effectiveStartDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required/></div>
    </div>
    <details className="membership-adjustments">
      <summary>Discount & tax{Number(discount) > 0 || Number(gstRate) > 0 ? ` · ${formatInr(toPaise(discount))} discount · ${gstRate}% GST` : ""}</summary>
      <div className="form-grid">
        <div className="field"><label htmlFor="membership-discount">Discount (₹)</label><input id="membership-discount" type="number" name="discount" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)}/></div>
        <div className="field"><label htmlFor="membership-gst">GST rate (%)</label><input id="membership-gst" type="number" name="gst_rate" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)}/></div>
      </div>
    </details>
    {renew && <fieldset className="membership-payment-fields"><legend>Payment</legend><div className="form-grid">
      <div className="field"><label htmlFor="membership-paid">Amount paid now (₹)</label><input id="membership-paid" type="number" name="amount_paid" min="0" max={totalAmount} step="0.01" value={amountPaid} onChange={(event) => changeAmountPaid(event.target.value)} required/></div>
      <div className="field"><label htmlFor="membership-method">Payment method</label><select id="membership-method" name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div>
      <div className="field member-field-wide"><label htmlFor="membership-reference">Reference (optional)</label><input id="membership-reference" name="reference"/></div>
    </div></fieldset>}
    <div className="membership-form-footer">
      <div><span className="muted">Total</span><strong>{formatInr(toPaise(totalAmount))}</strong>{renew && <small className="muted">Balance after payment: {formatInr(Math.max(0, toPaise(totalAmount) - toPaise(amountPaid)))}</small>}</div>
      <SubmitButton className="button" disabled={!plans.length} pendingLabel={renew ? "Renewing..." : "Creating membership..."}>{renew ? "Renew membership" : "Create membership"}</SubmitButton>
    </div>
    {!plans.length && <p className="alert error">Create an active plan before enrolling this member.</p>}
  </form>;
}
