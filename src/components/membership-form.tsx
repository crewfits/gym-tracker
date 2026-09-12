"use client";

import { useState } from "react";
import type { CurrencyCode, Plan, StaffHandlerOption, TrainerOption } from "@/lib/types";
import { calculateExpiry, calculatePaymentFollowUpDate, calculateRenewalStart, formatDisplayDate, formatInr } from "@/lib/domain";
import { PaymentEntries } from "@/components/payment-entries";
import { usePaymentRows } from "@/components/use-payment-rows";
import { usePaymentSubmit } from "@/components/use-payment-submit";
import { paymentRowsErrors, type SplitPaymentResult } from "@/lib/split-payments";

function planEndDate(plan: Plan | undefined, startDate: string) {
  return plan && startDate ? calculateExpiry(startDate, plan.duration_value, plan.duration_unit) : "";
}
function toPaise(value: string) { return Math.max(0, Math.round((Number(value) || 0) * 100)); }

export function MembershipForm({ memberId, plans, trainers = [], showTrainerAssignment = false, handlers = [], defaultHandlerId = "", action, today, currencyCode = "INR", renew = false, embedded = false, currentExpiry, defaultPlanId, defaultTrainerId, error, returnPath }: { memberId: string; plans: Plan[]; trainers?: TrainerOption[]; showTrainerAssignment?: boolean; handlers?: StaffHandlerOption[]; defaultHandlerId?: string; action: (data: FormData) => Promise<SplitPaymentResult>; today: string; currencyCode?: CurrencyCode; renew?: boolean; embedded?: boolean; currentExpiry?: string; defaultPlanId?: string | null; defaultTrainerId?: string | null; error?: string; returnPath?: string }) {
  const initialPlan = plans.find((plan) => plan.id === defaultPlanId) ?? plans[0];
  const [planId, setPlanId] = useState(initialPlan?.id ?? "");
  const [trainerId, setTrainerId] = useState(defaultTrainerId ?? "");
  const [handlerId, setHandlerId] = useState(defaultHandlerId);
  const [subtotal, setSubtotal] = useState(initialPlan ? (initialPlan.default_fee_paise / 100).toFixed(2) : "0.00");
  const [discount, setDiscount] = useState("0");
  const [gstRate, setGstRate] = useState("0");
  const [startDate, setStartDate] = useState(today);
  const effectiveStartDate = startDate ? renew ? calculateRenewalStart(currentExpiry ?? null, startDate) : startDate : "";
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const [endDate, setEndDate] = useState(planEndDate(selectedPlan, effectiveStartDate));
  const followUpDate = effectiveStartDate ? calculatePaymentFollowUpDate(effectiveStartDate) : today;
  const taxable = Math.max(0, toPaise(subtotal) - toPaise(discount));
  const totalPaise = taxable + Math.round(taxable * (Number(gstRate) || 0) / 100);
  const { rows, changeRows } = usePaymentRows(totalPaise, today);
  const { submit, pending, error: submissionError } = usePaymentSubmit(action);
  const invalidPayments = Object.keys(paymentRowsErrors(rows, totalPaise)).length > 0;

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

  return <form onSubmit={submit} aria-busy={pending} className={embedded ? "form member-renewal-form" : "card form"} style={embedded ? undefined : { maxWidth: 800 }} onInvalid={(event) => {
    const disclosure = (event.target as HTMLElement).closest("details");
    if (disclosure) disclosure.open = true;
  }}>
    <input type="hidden" name="member_id" value={memberId}/>
    {returnPath && <input type="hidden" name="return_path" value={returnPath}/>}
    <input type="hidden" name="due_on" value={followUpDate}/>
    {(submissionError || error) && <div className="alert error" role="alert">{submissionError || error}</div>}
    <div className="form-grid">
      <div className="field"><label htmlFor="membership-plan">Plan *</label><select id="membership-plan" name="plan_id" value={planId} onChange={(event) => selectPlan(event.target.value)} required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_value} {plan.duration_unit}</option>)}</select></div>
      <div className="field"><label htmlFor="membership-price">Plan price ({currencyCode}) *</label><input id="membership-price" type="number" name="subtotal" min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required/></div>
      <div className="field"><label htmlFor="membership-start">{renew ? "Renewal date" : "Start date"} *</label><input id="membership-start" type="date" name={renew ? "renewal_date" : "starts_on"} value={startDate} onChange={(event) => changeStartDate(event.target.value)} required/>{renew && effectiveStartDate !== startDate && <small>Membership starts {formatDisplayDate(effectiveStartDate)} after the current plan ends.</small>}</div>
      <div className="field"><label htmlFor="membership-end">Plan end date *</label><input id="membership-end" type="date" name="expires_on" min={effectiveStartDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required/></div>
      {showTrainerAssignment && <div className="field"><label htmlFor="membership-trainer">Trainer</label><select id="membership-trainer" name="assigned_trainer_user_id" value={trainerId} onChange={(event) => setTrainerId(event.target.value)}><option value="">No trainer assigned</option>{trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.display_name}</option>)}</select></div>}
      {handlers.length > 0 && <div className="field"><label htmlFor="membership-handler">Handled by *</label><select id="membership-handler" name="handled_by_gym_user_id" value={handlerId} onChange={(event) => setHandlerId(event.target.value)} required>{handlers.map((handler) => <option key={handler.id} value={handler.id}>{handler.display_name} · {handler.role}</option>)}</select><small>Who is handling this {renew ? "renewal" : "enrollment"}.</small></div>}
    </div>
    <details className="membership-adjustments">
      <summary>Discount & tax{Number(discount) > 0 || Number(gstRate) > 0 ? ` · ${formatInr(toPaise(discount), currencyCode)} discount · ${gstRate}% GST` : ""}</summary>
      <div className="form-grid">
        <div className="field"><label htmlFor="membership-discount">Discount ({currencyCode})</label><input id="membership-discount" type="number" name="discount" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)}/></div>
        <div className="field"><label htmlFor="membership-gst">GST rate (%)</label><input id="membership-gst" type="number" name="gst_rate" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)}/></div>
      </div>
    </details>
    <PaymentEntries rows={rows} onChange={changeRows} balancePaise={totalPaise} today={today} currencyCode={currencyCode} disabled={pending}/>
    <div className="membership-form-footer">
      <div><span className="muted">Total</span><strong>{formatInr(totalPaise, currencyCode)}</strong></div>
      <button type="submit" className="button" disabled={pending || invalidPayments || !plans.length || !subtotal || !startDate || !endDate || endDate < effectiveStartDate || Number(discount) > Number(subtotal)}>{pending ? "Saving…" : renew ? "Renew membership" : "Create membership"}</button>
    </div>
    {!plans.length && <p className="alert error">Create an active plan before enrolling this member.</p>}
  </form>;
}
