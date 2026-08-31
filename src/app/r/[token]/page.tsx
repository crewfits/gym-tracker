import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDisplayDate, formatInr, formatPaymentMethod } from "@/lib/domain";
import { verifyReceiptToken } from "@/lib/receipt-token";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PublicReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const paymentId = verifyReceiptToken((await params).token);
  if (!paymentId) notFound();
  const db = createAdminClient();
  const { data: payment } = await db.from("payments").select("id,amount_paise,method,paid_on,receipt_number,voided_at,payment_reversals(amount_paise),gyms(name,address,phone,email,gstin),charges!inner(subtotal_paise,discount_paise,gst_rate_basis_points,tax_paise,total_paise,memberships!inner(plan_name,starts_on,expires_on,members!inner(name,member_code)))").eq("id", paymentId).maybeSingle();
  if (!payment) notFound();
  const gym = Array.isArray(payment.gyms) ? payment.gyms[0] : payment.gyms;
  const charge = Array.isArray(payment.charges) ? payment.charges[0] : payment.charges;
  const membership = charge && (Array.isArray(charge.memberships) ? charge.memberships[0] : charge.memberships);
  const member = membership && (Array.isArray(membership.members) ? membership.members[0] : membership.members);
  if (!gym || !charge || !membership || !member) notFound();
  const reversedPaise = payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);

  return <main className="public-receipt-page"><div className="receipt"><div className="receipt-head"><div><p className="eyebrow">Payment receipt</p><h1>{gym.name}</h1><div className="muted">{gym.address}<br/>{gym.phone} {gym.email}</div></div><div className="receipt-number"><strong>{payment.receipt_number}</strong><br/><span className="muted">{formatDisplayDate(payment.paid_on)}</span>{gym.gstin && <><br/><span>GSTIN {gym.gstin}</span></>}</div></div>{payment.voided_at && <div className="alert error"><strong>PAYMENT REVERSED</strong><br/>This receipt is retained for history and no longer counts as a collection.</div>}{!payment.voided_at && reversedPaise > 0 && <div className="alert"><strong>PARTIAL REVERSAL RECORDED</strong><br/>Net payment: {formatInr(Number(payment.amount_paise) - reversedPaise)}.</div>}<div className="form-grid"><div><span className="metric-label">Received from</span><h2 style={{ marginTop: 6 }}>{member.name}</h2><p className="muted">{member.member_code}</p></div><div><span className="metric-label">For</span><h2 style={{ marginTop: 6 }}>{membership.plan_name} membership</h2><p className="muted">{formatDisplayDate(membership.starts_on)} — {formatDisplayDate(membership.expires_on)}</p></div></div><table className="table receipt-table"><tbody><tr><td>Plan price</td><td>{formatInr(Number(charge.subtotal_paise))}</td></tr><tr><td>Discount</td><td>− {formatInr(Number(charge.discount_paise))}</td></tr>{Number(charge.gst_rate_basis_points) > 0 && <tr><td>GST ({Number(charge.gst_rate_basis_points) / 100}%)</td><td>{formatInr(Number(charge.tax_paise))}</td></tr>}<tr><td><strong>Total amount</strong></td><td><strong>{formatInr(Number(charge.total_paise))}</strong></td></tr><tr><td><strong>Payment received via {formatPaymentMethod(payment.method)}</strong></td><td><strong>{formatInr(Number(payment.amount_paise))}</strong></td></tr>{reversedPaise > 0 && <tr><td><strong>Net payment</strong></td><td><strong>{formatInr(payment.voided_at ? 0 : Number(payment.amount_paise) - reversedPaise)}</strong></td></tr>}</tbody></table><small className="muted">This private receipt link was shared by {gym.name}. Do not forward it unless needed.</small></div></main>;
}
