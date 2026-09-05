"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeIndianRupee, Dumbbell, UserRound } from "lucide-react";
import { MemberPhotoField } from "@/components/member-photo-field";
import { memberValidationErrors, type CreateMemberResult, type MemberFieldErrors } from "@/lib/new-member-validation";
import { calculateExpiry, calculatePaymentFollowUpDate, formatDisplayDate, formatInr } from "@/lib/domain";
import type { Plan } from "@/lib/types";

type Props = { plans: Plan[]; today: string; error?: string; action: (formData: FormData) => Promise<CreateMemberResult> };
type EnrollmentSection = "profile" | "plan" | "payment";
const sectionFields: Record<EnrollmentSection, string[]> = {
  profile: ["name", "phone", "email", "notes", "shared_phone", "profile_photo_data_url"],
  plan: ["plan_id", "starts_on", "expires_on", "subtotal", "discount", "gst_rate"],
  payment: ["amount_paid", "paid_on", "method", "reference"],
};

function toPaise(value: string) { return Math.max(0, Math.round((Number(value) || 0) * 100)); }
function moneyFromPaise(value: number) { return (value / 100).toFixed(2); }
function planEndDate(plan: Plan | undefined, startDate: string) { return plan && startDate ? calculateExpiry(startDate, plan.duration_value, plan.duration_unit) : ""; }
function sectionForField(name: string): EnrollmentSection {
  if (["plan_id", "starts_on", "expires_on", "subtotal", "discount", "gst_rate"].includes(name)) return "plan";
  if (["amount_paid", "paid_on", "method", "reference"].includes(name)) return "payment";
  return "profile";
}

export function NewMemberForm({ plans, today, error, action }: Props) {
  const router = useRouter();
  const submitting = useRef(false);
  const paidInFull = useRef(true);
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({ name: "", phone: "", email: "", notes: "", reference: "", paid_on: today, method: "cash" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<MemberFieldErrors>({});
  const [formError, setFormError] = useState(error);
  const [reactivateUrl, setReactivateUrl] = useState<string>();
  const [activeSection, setActiveSection] = useState<EnrollmentSection>("profile");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const initialFee = plans[0] ? (plans[0].default_fee_paise / 100).toFixed(2) : "0.00";
  const [subtotal, setSubtotal] = useState(initialFee);
  const [discount, setDiscount] = useState("0");
  const [gstRate, setGstRate] = useState("0");
  const [amountPaid, setAmountPaid] = useState(initialFee);
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
    if (paidInFull.current) setAmountPaid(moneyFromPaise(totals.total));
  }, [amountPaid, totals.total]);

  function selectPlan(id: string) {
    setPlanId(id);
    const plan = plans.find((item) => item.id === id);
    if (!plan) return;
    const fee = (plan.default_fee_paise / 100).toFixed(2);
    setSubtotal(fee);
    setAmountPaid(fee);
    paidInFull.current = true;
    setDiscount("0");
    setGstRate("0");
    setEndDate(planEndDate(plan, startDate));
  }

  function changeStartDate(value: string) {
    setStartDate(value);
    setEndDate(planEndDate(selectedPlan, value));
  }

  function changeAmountPaid(value: string) {
    paidInFull.current = value !== "" && toPaise(value) === totals.total;
    setAmountPaid(value);
  }

  const validationErrors = memberValidationErrors({ ...values, plan_id: planId, starts_on: startDate, expires_on: endDate, subtotal, discount, gst_rate: gstRate, amount_paid: amountPaid });
  const visibleErrors = { ...Object.fromEntries(Object.entries(validationErrors).filter(([key]) => touched[key])), ...serverErrors };
  function fieldProps(name: string) {
    return { id: `member-${name}`, "aria-invalid": Boolean(visibleErrors[name]), "aria-describedby": visibleErrors[name] ? `member-${name}-error` : undefined };
  }
  function fieldError(name: string) {
    return visibleErrors[name] ? <small className="field-error" id={`member-${name}-error`} aria-live="polite">{visibleErrors[name]}</small> : null;
  }
  function goToNextSection(current: EnrollmentSection, next: EnrollmentSection) {
    const names = sectionFields[current];
    setTouched(previous => ({ ...previous, ...Object.fromEntries(names.map(name => [name, true])) }));
    const firstInvalid = names.find(name => validationErrors[name] || serverErrors[name]);
    if (firstInvalid) {
      window.requestAnimationFrame(() => (document.getElementById(`member-${firstInvalid}`) as HTMLElement | null)?.focus?.());
      return;
    }
    setActiveSection(next);
  }
  function handleChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    setValues(Object.fromEntries(new FormData(event.currentTarget)));
    setTouched(previous => ({ ...previous, [target.name]: true }));
    setServerErrors(previous => {
      const next = { ...previous };
      delete next[target.name];
      if (target.name === "phone") delete next.shared_phone;
      return next;
    });
    if (target.name === "phone") setReactivateUrl(undefined);
    setFormError(undefined);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const errors = memberValidationErrors(Object.fromEntries(data));
    setTouched(Object.fromEntries(Object.keys(errors).map(key => [key, true])));
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      setActiveSection(sectionForField(firstError));
      return;
    }
    submitting.current = true;
    setPending(true);
    setFormError(undefined);
    try {
      const result = await action(data);
      if (result.ok) {
        router.push(result.location);
        return;
      }
      setServerErrors(result.fieldErrors);
      setFormError(result.error);
      setReactivateUrl(result.reactivateUrl);
      const firstField = Object.keys(result.fieldErrors)[0];
      if (firstField) {
        setActiveSection(sectionForField(firstField));
        window.requestAnimationFrame(() => (form.elements.namedItem(firstField) as HTMLElement | null)?.focus?.());
      }
    } catch {
      setFormError("Could not activate membership. Your details and photo are still here. Please try again.");
    }
    submitting.current = false;
    setPending(false);
  }

  return <form onSubmit={submit} onChange={handleChange} onBlur={event => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) setTouched(previous => ({ ...previous, [target.name]: true }));
  }} noValidate className="enrollment-grid" aria-busy={pending}>
    <input type="hidden" name="due_on" value={followUpDate}/>
    <div className="enrollment-main">
      {formError && <div className="alert error" role="alert">{formError}</div>}
      <nav className="enrollment-steps" aria-label="New member sections">
        <button type="button" className={activeSection === "profile" ? "active" : ""} aria-current={activeSection === "profile" ? "step" : undefined} onClick={() => setActiveSection("profile")}><span>1</span><strong>Profile</strong><small>Name, contact and photo</small></button>
        <button type="button" className={activeSection === "plan" ? "active" : ""} aria-current={activeSection === "plan" ? "step" : undefined} onClick={() => setActiveSection("plan")}><span>2</span><strong>Membership</strong><small>Plan, dates and total</small></button>
        <button type="button" className={activeSection === "payment" ? "active" : ""} aria-current={activeSection === "payment" ? "step" : undefined} onClick={() => setActiveSection("payment")}><span>3</span><strong>Payment</strong><small>Collection and method</small></button>
      </nav>

      <section className="form-section enrollment-panel" id="member-profile" hidden={activeSection !== "profile"}>
        <div className="form-section-head"><span className="form-step"><UserRound size={17}/></span><div><p className="eyebrow">Member profile</p><h2>Personal details</h2></div></div>
        <MemberPhotoField submissionPending={pending} onPhotoChange={() => setServerErrors(previous => {
          const next = { ...previous }; delete next.profile_photo_data_url; return next;
        })}/>
        {fieldError("profile_photo_data_url")}
        <div className="form-grid">
          <div className="field"><label htmlFor="member-name">Full name <span className="required-marker" aria-hidden="true">*</span></label><input name="name" {...fieldProps("name")} required autoFocus placeholder="Member name"/>{fieldError("name")}</div>
          <div className="field"><label htmlFor="member-phone">Phone <span className="required-marker" aria-hidden="true">*</span></label><input name="phone" {...fieldProps("phone")} type="tel" autoComplete="tel" required placeholder="Contact number with country code when outside India"/>{fieldError("phone")}</div>
          <div className="field"><label htmlFor="member-email">Email</label><input name="email" {...fieldProps("email")} type="email" placeholder="Optional, for receipts"/>{fieldError("email")}</div>
          <div className="field"><label htmlFor="member-notes">Coach notes</label><input name="notes" {...fieldProps("notes")} placeholder="Goals, preferences, or notes"/>{fieldError("notes")}</div>
        </div>
        <div className="form-options enrollment-options">
          <label className="form-option"><input type="checkbox" name="generate_qr" defaultChecked/><span><strong>Generate QR pass</strong><small>Open the new member QR after activation.</small></span></label>
          <label className="form-option"><input type="checkbox" name="whatsapp_reminders_enabled"/><span><strong>WhatsApp reminder consent</strong><small>Enable only after the member agrees to receive automated payment reminders.</small></span></label>
          <div><label className="form-option"><input type="checkbox" name="shared_phone" {...fieldProps("shared_phone")}/><span><strong>Shared phone number</strong><small>Confirm this number is shared by up to 3 members.</small></span></label>{fieldError("shared_phone")}</div>
        </div>
        {reactivateUrl && <Link href={reactivateUrl} className="button secondary small">Open archived member to reactivate</Link>}
        <div className="enrollment-panel-actions"><button type="button" className="button" onClick={() => goToNextSection("profile", "plan")}>Continue to membership</button></div>
      </section>

      <section className="form-section enrollment-panel" id="member-plan" hidden={activeSection !== "plan"}>
        <div className="form-section-head"><span className="form-step"><Dumbbell size={17}/></span><div><p className="eyebrow">Membership</p><h2>Plan and membership period</h2></div></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="member-plan_id">Membership plan <span className="required-marker" aria-hidden="true">*</span></label><select name="plan_id" {...fieldProps("plan_id")} value={planId} onChange={(event) => selectPlan(event.target.value)} required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_value} {plan.duration_unit}</option>)}</select>{fieldError("plan_id")}</div>
          <div className="field"><label htmlFor="member-starts_on">Start date <span className="required-marker" aria-hidden="true">*</span></label><input type="date" name="starts_on" {...fieldProps("starts_on")} value={startDate} onChange={(event) => changeStartDate(event.target.value)} required/>{fieldError("starts_on")}</div>
          <div className="field"><label htmlFor="member-expires_on">Plan end date <span className="required-marker" aria-hidden="true">*</span></label><input type="date" name="expires_on" {...fieldProps("expires_on")} value={endDate} onChange={(event) => setEndDate(event.target.value)} required/>{fieldError("expires_on")}<small>Calculated from the selected plan; edit for exceptions.</small></div>
          <div className="field"><label htmlFor="member-subtotal">Base plan price (₹) <span className="required-marker" aria-hidden="true">*</span></label><input type="number" name="subtotal" {...fieldProps("subtotal")} min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required/>{fieldError("subtotal")}</div>
          <div className="field"><label htmlFor="member-discount">Member discount (₹)</label><input type="number" name="discount" {...fieldProps("discount")} min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)}/>{fieldError("discount")}</div>
          <div className="field"><label htmlFor="member-gst_rate">GST rate (%)</label><input type="number" name="gst_rate" {...fieldProps("gst_rate")} min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)}/>{fieldError("gst_rate")}<small>Tax is calculated after the discount.</small></div>
        </div>
        <div className="enrollment-panel-actions"><button type="button" className="button secondary" onClick={() => setActiveSection("profile")}>Back to profile</button><button type="button" className="button" onClick={() => goToNextSection("plan", "payment")}>Continue to payment</button></div>
      </section>

      <section className="form-section enrollment-panel" id="member-payment" hidden={activeSection !== "payment"}>
        <div className="form-section-head"><span className="form-step"><BadgeIndianRupee size={17}/></span><div><p className="eyebrow">Opening collection</p><h2>Initial payment</h2></div></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="member-amount_paid">Amount paid now (₹) <span className="required-marker" aria-hidden="true">*</span></label><input type="number" name="amount_paid" {...fieldProps("amount_paid")} min="0" max={moneyFromPaise(totals.total)} step="0.01" value={amountPaid} onChange={(event) => changeAmountPaid(event.target.value)} required/>{fieldError("amount_paid")}<small>Defaults to the full total. Enter a lower amount for partial payment.</small></div>
          <div className="field"><label htmlFor="member-paid_on">Payment date <span className="required-marker" aria-hidden="true">*</span></label><input type="date" name="paid_on" {...fieldProps("paid_on")} defaultValue={today} required/>{fieldError("paid_on")}</div>
          <div className="field"><label htmlFor="member-method">Payment method <span className="required-marker" aria-hidden="true">*</span></label><select name="method" {...fieldProps("method")}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select>{fieldError("method")}</div>
          <div className="field"><label htmlFor="member-reference">Transaction/reference</label><input name="reference" {...fieldProps("reference")} placeholder="Optional reference number"/>{fieldError("reference")}</div>
        </div>
        <div className="enrollment-panel-actions"><button type="button" className="button secondary" onClick={() => setActiveSection("plan")}>Back to membership</button><button type="submit" className="button" disabled={pending || !plans.length || Object.keys(validationErrors).length > 0 || Object.keys(serverErrors).length > 0}>{pending ? "Activating membership…" : "Activate membership"}</button></div>
      </section>
    </div>

    <aside className="card enrollment-summary"><div className="summary-hero"><p className="eyebrow">Membership total</p><div className="summary-total">{formatInr(totals.total)}</div><span>{selectedPlan?.name ?? "Choose a plan"}{selectedPlan ? ` · ${selectedPlan.duration_value} ${selectedPlan.duration_unit}` : ""}</span></div><div className="summary-lines"><div className="summary-line"><span>Start date</span><strong>{formatDisplayDate(startDate)}</strong></div><div className="summary-line"><span>Plan end date</span><strong>{formatDisplayDate(endDate)}</strong></div><div className="summary-line"><span>Base price</span><strong>{formatInr(totals.price)}</strong></div><div className="summary-line"><span>Discount</span><strong>− {formatInr(totals.discount)}</strong></div><div className="summary-line"><span>GST ({Number(gstRate) || 0}%)</span><strong>{formatInr(totals.tax)}</strong></div><div className="summary-line"><span>Total price</span><strong>{formatInr(totals.total)}</strong></div><div className="summary-line"><span>Paid today</span><strong>{formatInr(totals.paid)}</strong></div><div className="summary-line outstanding"><span>Balance to recover</span><strong>{formatInr(totals.outstanding)}</strong></div></div><div className="summary-actions"><button type="submit" className="button" disabled={pending || !plans.length || Object.keys(validationErrors).length > 0 || Object.keys(serverErrors).length > 0}>{pending ? "Activating membership…" : "Activate membership"}</button>{!plans.length && <p className="alert error" style={{ marginTop: 12, marginBottom: 0 }}>Create an active plan first.</p>}</div></aside>
  </form>;
}
