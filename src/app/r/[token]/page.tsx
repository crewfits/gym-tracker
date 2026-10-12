import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDisplayDate, formatInr, formatPaymentMethod, normalizeCurrencyCode } from "@/lib/domain";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { customerReceiptSummary, isConsolidatedCorrectionReceipt } from "@/lib/receipt-scope";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type ReceiptPayment = {
  id: string;
  charge_id: string;
  amount_paise: number;
  method: string;
  reference: string | null;
  paid_on: string;
  receipt_number: string;
  voided_at: string | null;
  operation_id: string | null;
  payment_reversals: { amount_paise: number }[];
};
export default async function PublicReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const paymentId = verifyReceiptToken((await params).token);
  if (!paymentId) notFound();
  const db = createAdminClient();
  const { data: payment } = await db.from("payments").select("id,charge_id,amount_paise,method,reference,paid_on,receipt_number,voided_at,operation_id,payment_reversals(amount_paise),gyms(name,address,phone,email,gstin,currency_code),charges!inner(subtotal_paise,discount_paise,gst_rate_basis_points,tax_paise,total_paise,memberships!inner(plan_name,starts_on,expires_on,members!inner(name,member_code)))").eq("id", paymentId).maybeSingle();
  if (!payment) notFound();
  const gym = Array.isArray(payment.gyms) ? payment.gyms[0] : payment.gyms;
  const charge = Array.isArray(payment.charges) ? payment.charges[0] : payment.charges;
  const membership = charge && (Array.isArray(charge.memberships) ? charge.memberships[0] : charge.memberships);
  const member = membership && (Array.isArray(membership.members) ? membership.members[0] : membership.members);
  if (!gym || !charge || !membership || !member) notFound();
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
  const consolidatedCorrection = await isConsolidatedCorrectionReceipt(db, payment.operation_id);
  const operationQuery = db.from("payments")
    .select("id,charge_id,amount_paise,method,reference,paid_on,receipt_number,voided_at,operation_id,payment_reversals(amount_paise)")
    .eq("charge_id", payment.charge_id);
  const { data: operationPayments, error: operationError } = payment.operation_id
    ? await (consolidatedCorrection ? operationQuery : operationQuery.eq("operation_id", payment.operation_id)).order("created_at", { ascending: true }).returns<ReceiptPayment[]>()
    : { data: null, error: null };
  if (operationError) throw operationError;
  const receiptPayments = operationPayments?.length ? operationPayments : [payment as ReceiptPayment];
  const primaryPayment = consolidatedCorrection ? payment as ReceiptPayment : receiptPayments[0];
  const customerReceipt = customerReceiptSummary(receiptPayments, consolidatedCorrection);
  const totalReceivedPaise = customerReceipt.totalReceivedPaise;
  const balanceDuePaise = Math.max(0, Number(charge.total_paise) - totalReceivedPaise);

  return <main className="public-receipt-page"><div className="receipt"><div className="receipt-head"><div><p className="eyebrow">Payment receipt</p><h1>{gym.name}</h1><div className="muted">{gym.address}<br/>{gym.phone} {gym.email}</div></div><div className="receipt-number"><strong>{primaryPayment.receipt_number}</strong><br/><span className="muted">{formatDisplayDate(primaryPayment.paid_on)}</span>{gym.gstin && <><br/><span>GSTIN {gym.gstin}</span></>}</div></div><div className="form-grid"><div><span className="metric-label">Received from</span><h2 style={{ marginTop: 6 }}>{member.name}</h2><p className="muted">{member.member_code}</p></div><div><span className="metric-label">For</span><h2 style={{ marginTop: 6 }}>{membership.plan_name} membership</h2><p className="muted">{formatDisplayDate(membership.starts_on)} — {formatDisplayDate(membership.expires_on)}</p></div></div><table className="table receipt-table"><tbody><tr><td>Plan price</td><td>{formatInr(Number(charge.subtotal_paise), currencyCode)}</td></tr><tr><td>Discount</td><td>− {formatInr(Number(charge.discount_paise), currencyCode)}</td></tr>{Number(charge.gst_rate_basis_points) > 0 && <tr><td>GST ({Number(charge.gst_rate_basis_points) / 100}%)</td><td>{formatInr(Number(charge.tax_paise), currencyCode)}</td></tr>}<tr><td><strong>Total amount</strong></td><td><strong>{formatInr(Number(charge.total_paise), currencyCode)}</strong></td></tr>{customerReceipt.lines.map(item => <tr key={item.id}><td><strong>{item.method ? `Payment received via ${formatPaymentMethod(item.method)}` : "Payment received"}</strong>{item.reference && <><br/><small className="muted">Reference: {item.reference}</small></>}</td><td><strong>{formatInr(item.amountPaise, currencyCode)}</strong></td></tr>)}{!consolidatedCorrection && <tr><td><strong>Paid on this receipt</strong></td><td><strong>{formatInr(totalReceivedPaise, currencyCode)}</strong></td></tr>}{balanceDuePaise > 0 && <tr><td><strong>Balance due</strong></td><td><strong>{formatInr(balanceDuePaise, currencyCode)}</strong></td></tr>}</tbody></table></div></main>;
}
