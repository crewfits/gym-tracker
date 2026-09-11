import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDisplayDate, formatInr, formatPaymentMethod } from "@/lib/domain";
import { roleLabel } from "@/lib/staff-handlers";

type HandlerRelation = { display_name: string | null; role: string } | Array<{ display_name: string | null; role: string }> | null;
function handlerName(handler: HandlerRelation) {
  const row = Array.isArray(handler) ? handler[0] : handler;
  return row ? row.display_name || roleLabel(row.role) : null;
}
import { Feedback } from "@/components/feedback";

export default async function PaymentCollectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase, gym } = await requirePermission("payments.view");
  const { data: operation, error } = await supabase.from("payment_operations").select("result").eq("id", id).eq("gym_id", gym.id).maybeSingle();
  if (error) throw error;
  if (!operation) notFound();
  const result = z.object({ member_id: z.uuid(), charge_id: z.uuid() }).parse(operation.result);
  const [{ data: member, error: memberError }, { data: payments, error: paymentsError }, { data: balance, error: balanceError }] = await Promise.all([
    supabase.from("members").select("name,member_code").eq("id", result.member_id).eq("gym_id", gym.id).single(),
    supabase.from("payments").select("id,receipt_number,amount_paise,method,paid_on,reference,voided_at,handled_by:gym_users!payments_handled_by_gym_user_fk(display_name,role),payment_reversals(amount_paise)").eq("operation_id", id).eq("gym_id", gym.id).order("receipt_number"),
    supabase.from("charge_balances").select("balance_paise").eq("id", result.charge_id).eq("gym_id", gym.id).single(),
  ]);
  if (memberError || paymentsError || balanceError) throw memberError || paymentsError || balanceError;
  const net = (payment: NonNullable<typeof payments>[number]) => payment.voided_at ? 0 : Number(payment.amount_paise) - payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
  return <div className="page-stack">
    <Feedback success={typeof query.success === "string" ? query.success : undefined}/>
    <div className="page-header"><div><p className="eyebrow">Payment collection</p><h1>{member.name}</h1><p className="muted">{member.member_code} · Each payment has its own receipt.</p></div></div>
    <div className="payment-entry-totals card"><span>Net collected <strong>{formatInr((payments ?? []).reduce((sum, payment) => sum + net(payment), 0))}</strong></span><span>Current membership balance <strong>{formatInr(Number(balance.balance_paise))}</strong></span></div>
    <div className="payment-entries">{payments.map(payment => <article className="card" key={payment.id}>
      <h2>{formatInr(Number(payment.amount_paise))} · {formatPaymentMethod(payment.method)}</h2>
      <p>{payment.receipt_number} · {formatDisplayDate(payment.paid_on)}</p>
      {payment.reference && <p className="muted">Reference: {payment.reference}</p>}
      {handlerName(payment.handled_by) && <p className="muted">Collected by {handlerName(payment.handled_by)}</p>}
      {net(payment) !== Number(payment.amount_paise) && <p className="alert">Reversal recorded. Net payment: {formatInr(net(payment))}.</p>}
      <Link className="button secondary" href={`/receipts/${payment.id}`}>View & share receipt</Link>
    </article>)}</div>
    <div className="inline-actions"><Link className="button" href={`/members/${result.member_id}/qr`}>Open QR pass</Link><Link className="button secondary" href={`/members/${result.member_id}?view=membership`}>Back to membership</Link></div>
  </div>;
}
