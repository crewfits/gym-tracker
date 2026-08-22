"use client";

import { useState } from "react";
import type { Plan } from "@/lib/types";

export function MembershipForm({ memberId, plans, action, today, renew = false, currentExpiry, error, returnPath }: { memberId: string; plans: Plan[]; action: (data: FormData) => void | Promise<void>; today: string; renew?: boolean; currentExpiry?: string; error?: string; returnPath?: string }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [subtotal, setSubtotal] = useState(plans[0] ? (plans[0].default_fee_paise / 100).toFixed(2) : "0.00");
  const [discount, setDiscount] = useState("0");
  const [gstRate, setGstRate] = useState("0");
  const total = Math.max(0, Number(subtotal || 0) - Number(discount || 0)) * (1 + Number(gstRate || 0) / 100);

  function selectPlan(id: string) {
    setPlanId(id);
    const plan = plans.find((item) => item.id === id);
    if (plan) setSubtotal((plan.default_fee_paise / 100).toFixed(2));
  }

  return <form action={action} className="card form" style={{ maxWidth: 800 }}>
    <input type="hidden" name="member_id" value={memberId}/>
    {returnPath && <input type="hidden" name="return_path" value={returnPath}/>}
    {error && <div className="alert error">{error}</div>}
    <div className="form-grid">
      <div className="field"><label>Plan *</label><select name="plan_id" value={planId} onChange={(event) => selectPlan(event.target.value)} required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · ₹{(plan.default_fee_paise / 100).toFixed(2)} · {plan.duration_value} {plan.duration_unit}</option>)}</select></div>
      <div className="field"><label>{renew ? "Renewal/payment date" : "Start date"} *</label><input type="date" name={renew ? "renewal_date" : "starts_on"} defaultValue={today} required/></div>
      <div className="field"><label>Payment due date *</label><input type="date" name="due_on" defaultValue={today} required/><small>Used when a balance remains outstanding.</small></div>
      <div className="field"><label>Plan price (₹) *</label><input type="number" name="subtotal" min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required/><small>Updated automatically when the selected plan changes.</small></div>
      <div className="field"><label>Discount (₹)</label><input type="number" name="discount" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)}/></div>
      <div className="field"><label>GST rate (%)</label><input type="number" name="gst_rate" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)}/><small>Set to 0 for a non-GST charge.</small></div>
      <div className="field"><label>Custom expiry date</label><input type="date" name="expires_on"/><small>Leave blank to calculate from the plan.{currentExpiry ? ` Current expiry: ${currentExpiry}.` : ""}</small></div>
      {renew && <><div className="field"><label>Amount paid now (₹)</label><input type="number" name="amount_paid" min="0" max={total.toFixed(2)} step="0.01" key={total.toFixed(2)} defaultValue={total.toFixed(2)} required/><small>Enter 0 to create the renewal with payment pending.</small></div><div className="field"><label>Payment method</label><select name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div><div className="field"><label>Transaction/reference</label><input name="reference" placeholder="Optional reference number"/></div></>}
    </div>
    <button className="button" style={{ justifySelf: "start" }} disabled={!plans.length}>{renew ? "Create renewal" : "Create membership"}</button>
    {!plans.length && <p className="alert error">Create an active plan before enrolling this member.</p>}
  </form>;
}
