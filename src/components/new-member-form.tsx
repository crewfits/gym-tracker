"use client";
import { useMemo, useState } from "react";
import type { Plan } from "@/lib/types";
import { formatInr } from "@/lib/domain";

type Props = { plans: Plan[]; today: string; error?: string; action: (formData: FormData) => Promise<void> };
function toPaise(value: string) { return Math.max(0, Math.round((Number(value) || 0) * 100)); }

export function NewMemberForm({ plans, today, error, action }: Props) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const initialFee = plans[0] ? (plans[0].default_fee_paise / 100).toFixed(2) : "0.00";
  const [subtotal, setSubtotal] = useState(initialFee);
  const [discount, setDiscount] = useState("0");
  const [gstRate, setGstRate] = useState("0");
  const [amountPaid, setAmountPaid] = useState(initialFee);
  const totals = useMemo(() => {
    const taxable = Math.max(0, toPaise(subtotal) - toPaise(discount));
    const tax = Math.round(taxable * Math.max(0, Number(gstRate) || 0) / 100);
    const total = taxable + tax;
    return { total, outstanding: Math.max(0, total - toPaise(amountPaid)) };
  }, [subtotal, discount, gstRate, amountPaid]);

  function selectPlan(id: string) {
    setPlanId(id);
    const plan = plans.find((item) => item.id === id);
    if (plan) { const fee = (plan.default_fee_paise / 100).toFixed(2); setSubtotal(fee); setAmountPaid(fee); }
  }

  return <form action={action} className="card form" style={{ maxWidth: 900 }}>
    {error && <div className="alert error">{error}</div>}
    <div><p className="eyebrow">Member details</p><h2>Who is joining?</h2></div>
    <div className="form-grid"><div className="field"><label>Full name *</label><input name="name" required autoFocus/></div><div className="field"><label>Phone *</label><input name="phone" required minLength={7}/></div><div className="field"><label>Email</label><input name="email" type="email"/><small>Used for reminders and emailed receipts.</small></div><div className="field"><label>Notes</label><input name="notes"/></div></div>
    <label><input type="checkbox" name="confirm_shared"/> Allow this phone to be shared with another member</label>
    <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }}/>
    <div><p className="eyebrow">Enrollment</p><h2>Select a membership plan</h2></div>
    <div className="form-grid"><div className="field"><label>Plan *</label><select name="plan_id" value={planId} onChange={(event) => selectPlan(event.target.value)} required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_value} {plan.duration_unit}</option>)}</select></div><div className="field"><label>Start date *</label><input type="date" name="starts_on" defaultValue={today} required/></div><div className="field"><label>Plan price (₹) *</label><input type="number" name="subtotal" min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required/></div><div className="field"><label>Discount (₹)</label><input type="number" name="discount" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)}/></div><div className="field"><label>GST rate (%)</label><input type="number" name="gst_rate" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)}/></div><div className="field"><label>Custom expiry date</label><input type="date" name="expires_on"/><small>Leave blank to calculate from the plan.</small></div></div>
    <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }}/>
    <div><p className="eyebrow">Initial payment</p><h2>Record the amount received</h2></div>
    <div className="form-grid"><div className="field"><label>Amount paid (₹)</label><input type="number" name="amount_paid" min="0" max={(totals.total / 100).toFixed(2)} step="0.01" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} required/><small>Enter 0 to enroll without collecting payment.</small></div><div className="field"><label>Payment date *</label><input type="date" name="paid_on" defaultValue={today} required/></div><div className="field"><label>Payment method *</label><select name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></div><div className="field"><label>Transaction/reference</label><input name="reference"/></div></div>
    <div className="card" style={{ background: "var(--paper)", boxShadow: "none" }}><div className="form-grid"><div><span className="metric-label">Membership total</span><strong style={{ display: "block", marginTop: 5 }}>{formatInr(totals.total)}</strong></div><div><span className="metric-label">Outstanding after payment</span><strong style={{ display: "block", marginTop: 5 }}>{formatInr(totals.outstanding)}</strong></div></div></div>
    <button className="button" style={{ justifySelf: "start" }} disabled={!plans.length}>Add member and enroll</button>
    {!plans.length && <p className="alert error">Create an active membership plan before adding a member.</p>}
  </form>;
}
