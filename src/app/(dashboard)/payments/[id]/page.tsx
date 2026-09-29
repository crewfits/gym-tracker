import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, QrCode, ReceiptText, UserRound } from "lucide-react";
import { z } from "zod";
import { Feedback } from "@/components/feedback";
import { requirePermission } from "@/lib/auth";
import { formatDisplayDate, formatInr, formatPaymentMethod, normalizeCurrencyCode } from "@/lib/domain";
import { roleLabel } from "@/lib/staff-handlers";

type HandlerRelation = { display_name: string | null; role: string } | Array<{ display_name: string | null; role: string }> | null;

function handlerName(handler: HandlerRelation) {
  const row = Array.isArray(handler) ? handler[0] : handler;
  return row ? row.display_name || roleLabel(row.role) : null;
}

export default async function PaymentCollectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase, gym } = await requirePermission("payments.view");
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
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
  const totalCollected = (payments ?? []).reduce((sum, payment) => sum + net(payment), 0);
  const primaryPayment = payments?.[0] ?? null;
  const methodSummary = (payments ?? []).map(payment => `${formatPaymentMethod(payment.method)} ${formatInr(net(payment), currencyCode)}`).join(" + ");
  const handlerSummary = [...new Set((payments ?? []).map(payment => handlerName(payment.handled_by)).filter(Boolean))];

  return <div className="page-stack payment-complete-page">
    <Feedback success={typeof query.success === "string" ? query.success : undefined}/>
    <section className="payment-complete-hero card">
      <div className="payment-complete-icon"><CheckCircle2 size={28}/></div>
      <div className="payment-complete-copy">
        <p className="eyebrow">Payment recorded</p>
        <h1>{formatInr(totalCollected, currencyCode)}</h1>
        <p className="muted">{member.name} · {member.member_code}</p>
      </div>
      <div className="payment-complete-balance">
        <span>Membership balance</span>
        <strong>{formatInr(Number(balance.balance_paise), currencyCode)}</strong>
      </div>
    </section>

    {primaryPayment && <article className="payment-complete-card card">
      <div className="payment-complete-card-head">
        <div><p className="eyebrow">Receipt ready</p><h2>{primaryPayment.receipt_number}</h2><p className="muted">{formatDisplayDate(primaryPayment.paid_on)}</p></div>
        <ReceiptText size={24} aria-hidden="true"/>
      </div>
      <div className="payment-complete-details">
        <span><strong>Payment mix</strong><small>{methodSummary || "No method details"}</small></span>
        {handlerSummary.length > 0 && <span><strong>Collected by</strong><small>{handlerSummary.join(", ")}</small></span>}
      </div>
      {(payments ?? []).some(payment => net(payment) !== Number(payment.amount_paise)) && <p className="alert">Reversal recorded. Net receipt amount: {formatInr(totalCollected, currencyCode)}.</p>}
      <div className="payment-complete-actions">
        <Link className="button" href={`/members/${result.member_id}/qr`}><QrCode size={16}/> Open QR pass & email</Link>
        <Link className="button secondary" href={`/receipts/${primaryPayment.id}`}><ReceiptText size={16}/> View receipt</Link>
        <Link className="button secondary" href={`/members/${result.member_id}?view=membership`}><UserRound size={16}/> Back to membership</Link>
      </div>
    </article>}
  </div>;
}
