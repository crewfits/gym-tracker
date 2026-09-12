"use client";

import { useId } from "react";
import { formatInr, formatPaymentMethod } from "@/lib/domain";
import { paymentMethods, paymentRowsErrors, paymentRowsTotal, type PaymentRow } from "@/lib/split-payments";
import type { CurrencyCode } from "@/lib/types";

export function PaymentEntries({ rows, onChange, balancePaise, today, currencyCode = "INR", required = false, disabled = false }: {
  rows: PaymentRow[]; onChange: (rows: PaymentRow[]) => void; balancePaise: number; today: string; currencyCode?: CurrencyCode; required?: boolean; disabled?: boolean;
}) {
  const id = useId();
  const errors = paymentRowsErrors(rows, balancePaise, required);
  const total = paymentRowsTotal(rows);
  function update(index: number, field: keyof PaymentRow, value: string) {
    onChange(rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }
  function feedback(index: number, field: string) {
    return errors[`${index}.${field}`] ? <small id={`${id}-${index}-${field}-error`} className="field-error" role="status">{errors[`${index}.${field}`]}</small> : null;
  }
  function attrs(index: number, field: string) {
    return { id: `${id}-${index}-${field}`, "aria-invalid": Boolean(errors[`${index}.${field}`]), "aria-describedby": errors[`${index}.${field}`] ? `${id}-${index}-${field}-error` : undefined };
  }
  return <div className="payment-entries">
    <input type="hidden" name="payments" value={JSON.stringify(rows)}/>
    {rows.map((row, index) => <fieldset key={row.key} disabled={disabled} className="payment-entry">
      <legend>Payment {index + 1}</legend>
      <div className="form-grid">
        <div className="field"><label htmlFor={`${id}-${index}-amount`}>Amount ({currencyCode}) <span className="required-marker">*</span></label><input {...attrs(index, "amount")} type="number" inputMode="decimal" min="0.01" step="0.01" value={row.amount} onChange={event => update(index, "amount", event.target.value)} required/>{feedback(index, "amount")}</div>
        <div className="field"><label htmlFor={`${id}-${index}-method`}>Method <span className="required-marker">*</span></label><select {...attrs(index, "method")} value={row.method} onChange={event => update(index, "method", event.target.value)}>{paymentMethods.map(method => <option key={method} value={method}>{formatPaymentMethod(method)}</option>)}</select>{feedback(index, "method")}</div>
        <div className="field"><label htmlFor={`${id}-${index}-paid_on`}>Payment date <span className="required-marker">*</span></label><input {...attrs(index, "paid_on")} type="date" value={row.paid_on} onChange={event => update(index, "paid_on", event.target.value)} required/>{feedback(index, "paid_on")}</div>
        <div className="field"><label htmlFor={`${id}-${index}-reference`}>Reference (optional)</label><input {...attrs(index, "reference")} value={row.reference} maxLength={200} onChange={event => update(index, "reference", event.target.value)}/>{feedback(index, "reference")}</div>
      </div>
      <button type="button" className="button secondary small" disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))} aria-label={`Remove payment ${index + 1}`}>Remove payment</button>
    </fieldset>)}
    {!rows.length && <p className="muted">{required ? "Add a payment to collect the balance." : "No payment received now. The membership balance will remain outstanding."}</p>}
    <button type="button" className="button small payment-add-button" disabled={disabled || rows.length >= 10} onClick={() => onChange([...rows, { key: crypto.randomUUID(), amount: (Math.max(0, balancePaise - total) / 100).toFixed(2), method: "cash", paid_on: today, reference: "" }])}>{rows.length ? "Add another payment" : "Add payment"}</button>
    <div className="payment-entry-totals" aria-live="polite"><span>Total paid <strong>{formatInr(total, currencyCode)}</strong></span><span>Remaining balance <strong>{formatInr(Math.max(0, balancePaise - total), currencyCode)}</strong></span></div>
    {errors.total && <p className="field-error" role="alert">{errors.total}</p>}
    {!required && rows.length > 0 && <small className="muted">For no payment today, remove all payment rows.</small>}
  </div>;
}
