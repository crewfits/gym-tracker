import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDisplayDate, formatInr, formatPaymentMethod, normalizeCurrencyCode } from "@/lib/domain";
import { verifyReceiptToken } from "@/lib/receipt-token";

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
function paymentNet(payment: ReceiptPayment) {
  const reversed = payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
  return payment.voided_at ? 0 : Math.max(0, Number(payment.amount_paise) - reversed);
}

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
  const { data: operationPayments, error: operationError } = payment.operation_id
    ? await db.from("payments")
      .select("id,charge_id,amount_paise,method,reference,paid_on,receipt_number,voided_at,operation_id,payment_reversals(amount_paise)")
      .eq("operation_id", payment.operation_id).eq("charge_id", payment.charge_id).order("created_at", { ascending: true }).returns<ReceiptPayment[]>()
    : { data: null, error: null };
  if (operationError) throw operationError;
  const receiptPayments = operationPayments?.length ? operationPayments : [payment as ReceiptPayment];
  const primaryPayment = receiptPayments[0];
  const totalReceivedPaise = receiptPayments.reduce((sum, item) => sum + paymentNet(item), 0);
  const balanceDuePaise = Math.max(0, Number(charge.total_paise) - totalReceivedPaise);
  const hasReversals = receiptPayments.some(item => item.voided_at || item.payment_reversals.length > 0);

  return <main className="public-receipt-page"><div className="receipt"><div className="receipt-head"><div><p className="eyebrow">Payment receipt</p><h1>{gym.name}</h1><div className="muted">{gym.address}<br/>{gym.phone} {gym.email}</div></div><div className="receipt-number"><strong>{primaryPayment.receipt_number}</strong><br/><span className="muted">{formatDisplayDate(primaryPayment.paid_on)}</span>{gym.gstin && <><br/><span>GSTIN {gym.gstin}</span></>}</div></div>{hasReversals && <div className="alert"><strong>REVERSAL RECORDED</strong><br/>This receipt shows the current net amount after any recorded reversals.</div>}<div className="form-grid"><div><span className="metric-label">Received from</span><h2 style={{ marginTop: 6 }}>{member.name}</h2><p className="muted">{member.member_code}</p></div><div><span className="metric-label">For</span><h2 style={{ marginTop: 6 }}>{membership.plan_name} membership</h2><p className="muted">{formatDisplayDate(membership.starts_on)} — {formatDisplayDate(membership.expires_on)}</p></div></div><table className="table receipt-table"><tbody><tr><td>Plan price</td><td>{formatInr(Number(charge.subtotal_paise), currencyCode)}</td></tr><tr><td>Discount</td><td>− {formatInr(Number(charge.discount_paise), currencyCode)}</td></tr>{Number(charge.gst_rate_basis_points) > 0 && <tr><td>GST ({Number(charge.gst_rate_basis_points) / 100}%)</td><td>{formatInr(Number(charge.tax_paise), currencyCode)}</td></tr>}<tr><td><strong>Total amount</strong></td><td><strong>{formatInr(Number(charge.total_paise), currencyCode)}</strong></td></tr>{receiptPayments.map(item => {
    const reversed = item.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
    return <tr key={item.id}><td><strong>Payment received via {formatPaymentMethod(item.method)}</strong>{item.reference && <><br/><small className="muted">Reference: {item.reference}</small></>}{reversed > 0 && <><br/><small className="muted">Reversed: {formatInr(reversed, currencyCode)}</small></>}</td><td><strong>{formatInr(paymentNet(item), currencyCode)}</strong></td></tr>;
  })}<tr><td><strong>Paid on this receipt</strong></td><td><strong>{formatInr(totalReceivedPaise, currencyCode)}</strong></td></tr>{balanceDuePaise > 0 && <tr><td><strong>Balance due</strong></td><td><strong>{formatInr(balanceDuePaise, currencyCode)}</strong></td></tr>}</tbody></table></div></main>;
}
