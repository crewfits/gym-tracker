"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeIndianRupee, Dumbbell, UserRound } from "lucide-react";
import type { Plan } from "@/lib/types";
import { calculateExpiry, calculatePaymentFollowUpDate, formatDisplayDate, formatInr } from "@/lib/domain";
import { MemberPhotoField } from "@/components/member-photo-field";

type Props = { plans: Plan[]; today: string; error?: string; action: (formData: FormData) => Promise<void> };
function toPaise(value: string) { return Math.max(0, Math.round((Number(value) || 0) * 100)); }
function moneyFromPaise(value: number) { return (value / 100).toFixed(2); }
function planEndDate(plan: Plan | undefined, startDate: string) { return plan && startDate ? calculateExpiry(startDate, plan.duration_value, plan.duration_unit) : ""; }

export function NewMemberForm({ plans, today, error, action }: Props) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const initialFee = plans[0] ? (plans[0].default_fee_paise / 100).toFixed(2) : "0.00";
  const [subtotal, setSubtotal] = useState(initialFee);
  const [discount, setDiscount] = useState("0");
  const [gstRate, setGstRate] = useState("0");
  const [amountPaid, setAmountPaid] = useState(initialFee);
  const paidInFull = useRef(true);
  const [startDate, setStartDate] = useState(today);
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const calculatedEndDate = planEndDate(selectedPlan, startDate);
  const [endDate, setEndDate] = useState(calculatedEndDate);
  const followUpDate = startDate ? calculatePaymentFollowUpDate(startDate) : today;
  const totals = useMemo(() => {
    const price = toPaise(subtotal);
    const discountPaise = Math.min(toPaise(discount), price);
    const taxable = price - discountPaise;
    const tax = Math.round(taxable * Math.max(0, Number(gstRate) || 0) / 100);
    const total = taxable + tax;
    const paid = Math.min(toPaise(amountPaid), total);
    return { price, discount: discountPaise, tax, total, paid, outstanding: total - paid };
  }, [subtotal, discount, gstRate, amountPaid]);

  useEffect(() => {
    const paid = toPaise(amountPaid);
    if (paidInFull.current || paid > totals.total) setAmountPaid(moneyFromPaise(totals.total));
  }, [amountPaid, totals.total]);

  function selectPlan(id: string) {
    setPlanId(id);
    const plan = plans.find((item) => item.id === id);
    if (plan) {
      const fee = (plan.default_fee_paise / 100).toFixed(2);
      setSubtotal(fee);
      setAmountPaid(fee);
      paidInFull.current = true;
      setDiscount("0");
      setGstRate("0");
      setEndDate(planEndDate(plan, startDate));
    }
  }

  function changeStartDate(value: string) {
    setStartDate(value);
    setEndDate(planEndDate(selectedPlan, value));
  }

  function changeAmountPaid(value: string) {
    const enteredPaise = toPaise(value);
    const nextPaid = Math.min(enteredPaise, totals.total);
    paidInFull.current = nextPaid >= totals.total;
    setAmountPaid(enteredPaise > totals.total ? moneyFromPaise(totals.total) : value);
  }

  return <form action={action} className="enrollment-grid">
    <input type="hidden" name="due_on" value={followUpDate}/>
    <div className="enrollment-main">
      {error && <div className="alert error">{error}</div>}
      <section className="form-section"><div className="form-section-head"><span className="form-step"><UserRound size={17}/></span><div><p className="eyebrow">Member profile</p><h2>Personal details</h2></div></div><MemberPhotoField/><div className="form-grid"><div className="field"><label>Full name *</label><input name="name" required autoFocus placeholder="Member name"/></div><div className="field"><label>Phone *</label><input name="phone" required minLength={7} placeholder="Contact number with country code when outside India"/></div><div className="field"><label>Email</label><input name="email" type="email" placeholder="Optional, for receipts"/></div><div className="field"><label>Coach notes</label><input name="notes" placeholder="Goals, preferences, or notes"/></div></div><div className="form-options"><label className="form-option"><input type="checkbox" name="generate_qr" defaultChecked/><span><strong>Generate QR pass</strong><small>Open the new member QR after activation.</small></span></label><label className="form-option"><input type="checkbox" name="whatsapp_reminders_enabled"/><span><strong>WhatsApp reminder consent</strong><small>Enable only after the member agrees to receive automated payment reminders.</small></span></label></div></section>

      <section className="form-section"><div className="form-section-head"><span className="form-step"><Dumbbell size={17}/></span><div><p className="eyebrow">Membership</p><h2>Plan and membership period</h2></div></div><div className="form-grid"><div className="field"><label>Membership plan *</label><select name="plan_id" value={planId} onChange={(event) => selectPlan(event.target.value)} required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_value} {plan.duration_unit}</option>)}</select></div><div className="field"><label>Start date *</label><input type="date" name="starts_on" value={startDate} onChange={(event) => changeStartDate(event.target.value)} required/></div><div className="field"><label>Plan end date *</label><input type="date" name="expires_on" value={endDate} onChange={(event) => setEndDate(event.target.value)} required/><small>Calculated from the selected plan; edit for exceptions.</small></div><div className="field"><label>Base plan price (₹) *</label><input type="number" name="subtotal" min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required/></div><div className="field"><label>Member discount (₹)</label><input type="number" name="discount" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)}/></div><div className="field"><label>GST rate (%)</label><input type="number" name="gst_rate" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)}/><small>Tax is calculated after the discount.</small></div></div></section>

      <section className="form-section"><div className="form-section-head"><span className="form-step"><BadgeIndianRupee size={17}/></span><div><p className="eyebrow">Opening collection</p><h2>Initial payment</h2></div></div><div className="form-grid"><div className="field"><label>Amount paid now (₹)</label><input type="number" name="amount_paid" min="0" max={moneyFromPaise(totals.total)} step="0.01" value={amountPaid} onChange={(event) => changeAmountPaid(event.target.value)} required/><small>Defaults to the full total. Enter a lower amount for partial payment.</small></div><div className="field"><label>Payment date *</label><input type="date" name="paid_on" defaultValue={today} required/></div><div className="field"><label>Payment method *</label><select name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></div><div className="field"><label>Transaction/reference</label><input name="reference" placeholder="Optional reference number"/></div></div></section>
    </div>

    <aside className="card enrollment-summary"><div className="summary-hero"><p className="eyebrow">Membership total</p><div className="summary-total">{formatInr(totals.total)}</div><span>{selectedPlan?.name ?? "Choose a plan"}{selectedPlan ? ` · ${selectedPlan.duration_value} ${selectedPlan.duration_unit}` : ""}</span></div><div className="summary-lines"><div className="summary-line"><span>Start date</span><strong>{formatDisplayDate(startDate)}</strong></div><div className="summary-line"><span>Plan end date</span><strong>{formatDisplayDate(endDate)}</strong></div><div className="summary-line"><span>Base price</span><strong>{formatInr(totals.price)}</strong></div><div className="summary-line"><span>Discount</span><strong>− {formatInr(totals.discount)}</strong></div><div className="summary-line"><span>GST ({Number(gstRate) || 0}%)</span><strong>{formatInr(totals.tax)}</strong></div><div className="summary-line"><span>Total price</span><strong>{formatInr(totals.total)}</strong></div><div className="summary-line"><span>Paid today</span><strong>{formatInr(totals.paid)}</strong></div><div className="summary-line outstanding"><span>Balance to recover</span><strong>{formatInr(totals.outstanding)}</strong></div></div><div className="summary-actions"><button className="button" disabled={!plans.length}>Activate membership</button>{!plans.length && <p className="alert error" style={{ marginTop: 12, marginBottom: 0 }}>Create an active plan first.</p>}</div></aside>
  </form>;
}
