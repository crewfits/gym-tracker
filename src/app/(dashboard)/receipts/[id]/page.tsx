import Link from "next/link";
import { notFound } from "next/navigation";
import { Feedback } from "@/components/feedback";
import { reversePayment } from "@/app/actions/core";
import { ReversePaymentForm } from "@/components/reverse-payment-form";
import { PrintButton, ShareReceiptButton, WhatsAppReceiptButton } from "@/components/print-button";
import { requestAppOrigin } from "@/lib/app-origin";
import { requirePermission } from "@/lib/auth";
import { formatDisplayDate, formatInr, formatPaymentMethod } from "@/lib/domain";
import { roleLabel } from "@/lib/staff-handlers";

type HandlerRelation = { display_name: string | null; role: string } | Array<{ display_name: string | null; role: string }> | null;
function handlerName(handler: HandlerRelation) {
  const row = Array.isArray(handler) ? handler[0] : handler;
  return row ? row.display_name || roleLabel(row.role) : null;
}
import { createReceiptToken } from "@/lib/receipt-token";
import { whatsappClickToChatUrl } from "@/lib/reminders";

export default async function ReceiptPage({ params, searchParams }: PageProps<"/receipts/[id]">) {
  const [{ id }, query, origin] = await Promise.all([params, searchParams, requestAppOrigin()]);
  const { supabase, gym } = await requirePermission("payments.view");
  const { data: payment } = await supabase.from("payments").select("*, handled_by:gym_users!payments_handled_by_gym_user_fk(display_name,role), payment_reversals(amount_paise,reason,created_at), charges!inner(*, memberships!inner(*, handled_by:gym_users!memberships_handled_by_gym_user_fk(display_name,role), members!inner(*)))").eq("id", id).eq("gym_id", gym.id).single();
  if (!payment) notFound();
  const charge = payment.charges;
  const membership = charge.memberships;
  const member = membership.members;
  const reversedPaise = payment.payment_reversals.reduce((sum: number, reversal: { amount_paise: number }) => sum + Number(reversal.amount_paise), 0);
  const remainingPaise = payment.voided_at ? 0 : Math.max(0, Number(payment.amount_paise) - reversedPaise);
  const success = typeof query.success === "string" ? query.success : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const publicUrl = `${origin}/r/${createReceiptToken(payment.id)}`;
  const paymentHandler = handlerName(payment.handled_by);
  const membershipHandler = handlerName(membership.handled_by);
  const paidOn = formatDisplayDate(payment.paid_on);
  const receiptMessage = `Hi ${member.name}, payment receipt ${payment.receipt_number} for ${formatInr(remainingPaise)}${payment.voided_at || reversedPaise > 0 ? " (net after reversal)" : ""}, paid on ${paidOn} to ${gym.name}: ${publicUrl}`;
  let whatsappUrl: string | null = null;
  try {
    whatsappUrl = whatsappClickToChatUrl(member.phone, process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91", receiptMessage);
  } catch {
    // Keep receipts accessible for imported members without a routable phone.
  }

  return <div className="receipt">
    <Feedback success={success} error={error}/>
    <div className="receipt-head"><div><p className="eyebrow">Payment receipt</p><h1>{gym.name}</h1><div className="muted">{gym.address}<br/>{gym.phone} {gym.email}</div></div><div className="receipt-number"><strong>{payment.receipt_number}</strong><br/><span className="muted">{paidOn}</span>{gym.gstin && <><br/><span>GSTIN {gym.gstin}</span></>}</div></div>
    {payment.voided_at && <div className="alert error"><strong>PAYMENT REVERSED</strong><br/>Reason: {payment.void_reason}. This receipt is retained for audit history and no longer counts toward collections.</div>}
    {!payment.voided_at && reversedPaise > 0 && <div className="alert"><strong>PARTIAL REVERSAL RECORDED</strong><br/>{formatInr(reversedPaise)} has been reversed. Net payment: {formatInr(Number(payment.amount_paise) - reversedPaise)}.</div>}
    <div className="form-grid"><div><span className="metric-label">Received from</span><h2 style={{ marginTop: 6 }}>{member.name}</h2><p className="muted">{member.member_code} · {member.phone}</p></div><div><span className="metric-label">For</span><h2 style={{ marginTop: 6 }}>{membership.plan_name} membership</h2><p className="muted">{formatDisplayDate(membership.starts_on)} — {formatDisplayDate(membership.expires_on)}</p></div></div>
    <table className="table receipt-table"><tbody><tr><td>Plan price</td><td>{formatInr(Number(charge.subtotal_paise))}</td></tr><tr><td>Discount</td><td>− {formatInr(Number(charge.discount_paise))}</td></tr>{Number(charge.gst_rate_basis_points) > 0 && <tr><td>GST ({Number(charge.gst_rate_basis_points) / 100}%)</td><td>{formatInr(Number(charge.tax_paise))}</td></tr>}<tr><td><strong>Total amount</strong></td><td><strong>{formatInr(Number(charge.total_paise))}</strong></td></tr><tr><td><strong>Payment received via {formatPaymentMethod(payment.method)}</strong></td><td><strong>{formatInr(Number(payment.amount_paise))}</strong></td></tr>{reversedPaise > 0 && <><tr><td>Amount reversed</td><td>− {formatInr(reversedPaise)}</td></tr><tr><td><strong>Net payment</strong></td><td><strong>{formatInr(payment.voided_at ? 0 : Number(payment.amount_paise) - reversedPaise)}</strong></td></tr></>}</tbody></table>
    {payment.reference && <p><strong>Reference:</strong> {payment.reference}</p>}
    {(paymentHandler || membershipHandler) && <p className="muted">{paymentHandler && <>Collected by {paymentHandler}</>}{paymentHandler && membershipHandler && " · "}{membershipHandler && <>Membership handled by {membershipHandler}</>}</p>}
    <div className="receipt-actions no-print"><PrintButton/>{whatsappUrl && <WhatsAppReceiptButton url={whatsappUrl}/>}<ShareReceiptButton receiptNumber={payment.receipt_number} url={publicUrl}/><Link className="button success" href={`/members/${member.id}`}>Done, back to member</Link></div>
    {remainingPaise > 0 && <div className="no-print"><ReversePaymentForm paymentId={payment.id} memberId={member.id} remainingPaise={remainingPaise} action={reversePayment}/></div>}
  </div>;
}
