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
type ReceiptPayment = {
  id: string;
  amount_paise: number;
  method: string;
  reference: string | null;
  paid_on: string;
  receipt_number: string;
  voided_at: string | null;
  void_reason: string | null;
  operation_id: string | null;
  handled_by: HandlerRelation;
  payment_reversals: { amount_paise: number; reason?: string | null; created_at?: string | null }[];
};
function handlerName(handler: HandlerRelation) {
  const row = Array.isArray(handler) ? handler[0] : handler;
  return row ? row.display_name || roleLabel(row.role) : null;
}
function paymentNet(payment: ReceiptPayment) {
  const reversed = payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
  return payment.voided_at ? 0 : Math.max(0, Number(payment.amount_paise) - reversed);
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
  const { data: operationPayments, error: operationError } = payment.operation_id
    ? await supabase.from("payments")
      .select("id,amount_paise,method,reference,paid_on,receipt_number,voided_at,void_reason,operation_id,handled_by:gym_users!payments_handled_by_gym_user_fk(display_name,role),payment_reversals(amount_paise,reason,created_at)")
      .eq("gym_id", gym.id).eq("operation_id", payment.operation_id).eq("charge_id", payment.charge_id).order("created_at", { ascending: true }).returns<ReceiptPayment[]>()
    : { data: null, error: null };
  if (operationError) throw operationError;
  const receiptPayments = operationPayments?.length ? operationPayments : [payment as ReceiptPayment];
  const primaryPayment = receiptPayments[0];
  const totalReceivedPaise = receiptPayments.reduce((sum, item) => sum + paymentNet(item), 0);
  const balanceDuePaise = Math.max(0, Number(charge.total_paise) - totalReceivedPaise);
  const hasReversals = receiptPayments.some(item => item.voided_at || item.payment_reversals.length > 0);
  const remainingPaise = paymentNet(payment as ReceiptPayment);
  const success = typeof query.success === "string" ? query.success : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const publicUrl = `${origin}/r/${createReceiptToken(primaryPayment.id)}`;
  const paymentHandlers = [...new Set(receiptPayments.map(item => handlerName(item.handled_by)).filter((value): value is string => Boolean(value)))];
  const membershipHandler = handlerName(membership.handled_by);
  const paidOn = formatDisplayDate(primaryPayment.paid_on);
  const receiptMessage = `Hi ${member.name}, payment receipt ${primaryPayment.receipt_number} for ${formatInr(totalReceivedPaise)}${hasReversals ? " (net after reversal)" : ""}, paid on ${paidOn} to ${gym.name}. Balance due: ${formatInr(balanceDuePaise)}. ${publicUrl}`;
  let whatsappUrl: string | null = null;
  try {
    whatsappUrl = whatsappClickToChatUrl(member.phone, process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91", receiptMessage);
  } catch {
    // Keep receipts accessible for imported members without a routable phone.
  }

  return <div className="receipt">
    <Feedback success={success} error={error}/>
    <div className="receipt-head"><div><p className="eyebrow">Payment receipt</p><h1>{gym.name}</h1><div className="muted">{gym.address}<br/>{gym.phone} {gym.email}</div></div><div className="receipt-number"><strong>{primaryPayment.receipt_number}</strong><br/><span className="muted">{paidOn}</span>{gym.gstin && <><br/><span>GSTIN {gym.gstin}</span></>}</div></div>
    {hasReversals && <div className="alert"><strong>REVERSAL RECORDED</strong><br/>This receipt shows the current net amount after any recorded reversals.</div>}
    <div className="form-grid"><div><span className="metric-label">Received from</span><h2 style={{ marginTop: 6 }}>{member.name}</h2><p className="muted">{member.member_code} · {member.phone}</p></div><div><span className="metric-label">For</span><h2 style={{ marginTop: 6 }}>{membership.plan_name} membership</h2><p className="muted">{formatDisplayDate(membership.starts_on)} — {formatDisplayDate(membership.expires_on)}</p></div></div>
    <table className="table receipt-table"><tbody><tr><td>Plan price</td><td>{formatInr(Number(charge.subtotal_paise))}</td></tr><tr><td>Discount</td><td>− {formatInr(Number(charge.discount_paise))}</td></tr>{Number(charge.gst_rate_basis_points) > 0 && <tr><td>GST ({Number(charge.gst_rate_basis_points) / 100}%)</td><td>{formatInr(Number(charge.tax_paise))}</td></tr>}<tr><td><strong>Total amount</strong></td><td><strong>{formatInr(Number(charge.total_paise))}</strong></td></tr>{receiptPayments.map(item => {
      const reversed = item.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
      return <tr key={item.id}><td><strong>Payment received via {formatPaymentMethod(item.method)}</strong>{item.reference && <><br/><small className="muted">Reference: {item.reference}</small></>}{reversed > 0 && <><br/><small className="muted">Reversed: {formatInr(reversed)}</small></>}</td><td><strong>{formatInr(paymentNet(item))}</strong></td></tr>;
    })}<tr><td><strong>Paid on this receipt</strong></td><td><strong>{formatInr(totalReceivedPaise)}</strong></td></tr><tr><td><strong>Balance due</strong></td><td><strong>{formatInr(balanceDuePaise)}</strong></td></tr></tbody></table>
    {(paymentHandlers.length || membershipHandler) && <p className="muted">{paymentHandlers.length ? <>Collected by {paymentHandlers.join(", ")}</> : null}{paymentHandlers.length && membershipHandler && " · "}{membershipHandler && <>Membership handled by {membershipHandler}</>}</p>}
    <div className="receipt-actions no-print"><PrintButton/>{whatsappUrl && <WhatsAppReceiptButton url={whatsappUrl}/>}<ShareReceiptButton receiptNumber={primaryPayment.receipt_number} url={publicUrl}/><Link className="button success" href={`/members/${member.id}`}>Done, back to member</Link></div>
    {receiptPayments.length === 1 && remainingPaise > 0 && <div className="no-print"><ReversePaymentForm paymentId={payment.id} memberId={member.id} remainingPaise={remainingPaise} action={reversePayment}/></div>}
  </div>;
}
