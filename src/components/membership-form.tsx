"use client";

import { useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/types";
import { calculateExpiry, calculatePaymentFollowUpDate, calculateRenewalStart, formatDisplayDate } from "@/lib/domain";

function planEndDate(plan: Plan | undefined, startDate: string) {
  return plan && startDate ? calculateExpiry(startDate, plan.duration_value, plan.duration_unit) : "";
}
function toPaise(value: string) { return Math.max(0, Math.round((Number(value) || 0) * 100)); }

export function MembershipForm({ memberId, plans, action, today, renew = false, currentExpiry, error, returnPath }: { memberId: string; plans: Plan[]; action: (data: FormData) => void | Promise<void>; today: string; renew?: boolean; currentExpiry?: string; error?: string; returnPath?: string }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [subtotal, setSubtotal] = useState(plans[0] ? (plans[0].default_fee_paise / 100).toFixed(2) : "0.00");
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

  return <form action={action} className="card form" style={{ maxWidth: 800 }}>
    <input type="hidden" name="member_id" value={memberId}/>
    {returnPath && <input type="hidden" name="return_path" value={returnPath}/>}
    <input type="hidden" name="due_on" value={followUpDate}/>
    {error && <div className="alert error">{error}</div>}
    <div className="form-grid">
      <div className="field"><label>Plan *</label><select name="plan_id" value={planId} onChange={(event) => selectPlan(event.target.value)} required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · ₹{(plan.default_fee_paise / 100).toFixed(2)} · {plan.duration_value} {plan.duration_unit}</option>)}</select></div>
      <div className="field"><label>{renew ? "Renewal date" : "Start date"} *</label><input type="date" name={renew ? "renewal_date" : "starts_on"} value={startDate} onChange={(event) => changeStartDate(event.target.value)} required/>{renew && currentExpiry && <small>Early renewals start after {formatDisplayDate(currentExpiry)}.</small>}</div>
      <div className="field"><label>Plan end date *</label><input type="date" name="expires_on" value={endDate} onChange={(event) => setEndDate(event.target.value)} required/><small>Calculated from the selected plan; edit for exceptions.</small></div>
      <div className="field"><label>Plan price (₹) *</label><input type="number" name="subtotal" min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required/><small>Updated automatically when the selected plan changes.</small></div>
      <div className="field"><label>Discount (₹)</label><input type="number" name="discount" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)}/></div>
      <div className="field"><label>GST rate (%)</label><input type="number" name="gst_rate" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)}/><small>Set to 0 for a non-GST charge.</small></div>
      {renew && <><div className="field"><label>Amount paid now (₹)</label><input type="number" name="amount_paid" min="0" max={totalAmount} step="0.01" value={amountPaid} onChange={(event) => changeAmountPaid(event.target.value)} required/><small>Defaults to the full total. Enter a lower amount for partial payment.</small></div><div className="field"><label>Payment method</label><select name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div><div className="field"><label>Transaction/reference</label><input name="reference" placeholder="Optional reference number"/></div></>}
    </div>
    <button className="button" style={{ justifySelf: "start" }} disabled={!plans.length}>{renew ? "Create renewal" : "Create membership"}</button>
    {!plans.length && <p className="alert error">Create an active plan before enrolling this member.</p>}
  </form>;
}
