import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr } from "@/lib/domain";
import { collectPayments } from "@/app/actions/split-payments";
import { CollectPaymentForm } from "@/components/collect-payment-form";
import { Feedback } from "@/components/feedback";
import { loadStaffHandlers } from "@/lib/staff-handlers";

export default async function Pay({ params, searchParams }: PageProps<"/members/[id]/pay">) {
  const [{ id }, p] = await Promise.all([params, searchParams]);
  if (!p.charge || typeof p.charge !== "string") notFound();

  const { supabase, gym, user } = await requirePermission("payments.manage");
  const error = typeof p.error === "string" ? p.error : undefined;
  const [{ data: charge, error: chargeError }, { data: member, error: memberError }, handlerData] = await Promise.all([
    supabase.from("charges")
      .select("*, memberships!inner(member_id,plan_name,starts_on,expires_on,reverted_at)")
      .eq("id", p.charge).eq("gym_id", gym.id).single(),
    supabase.from("members").select("name,member_code").eq("id", id).eq("gym_id", gym.id).maybeSingle(),
    loadStaffHandlers(supabase, gym.id, user.id),
  ]);
  if (chargeError && chargeError.code !== "PGRST116") throw chargeError;
  if (memberError) throw memberError;
  if (!charge || !member || charge.memberships.member_id !== id || charge.memberships.reverted_at) notFound();

  const { data: payments, error: paymentsError } = await supabase.from("payments")
    .select("amount_paise,payment_reversals(amount_paise)")
    .eq("charge_id", charge.id).eq("gym_id", gym.id).is("voided_at", null);
  if (paymentsError) throw paymentsError;

  const paid = (payments ?? []).reduce(
    (sum, payment) => sum + Number(payment.amount_paise) - payment.payment_reversals.reduce((reversed, item) => reversed + Number(item.amount_paise), 0),
    0,
  );
  const balance = Number(charge.total_paise) - paid;
  const today = businessDate(gym.timezone);

  return <div className="member-collection-page">
    <header className="member-manage-head">
      <div><h1>Collect outstanding payment</h1><span className="muted">{member.name} · {member.member_code}</span></div>
      <Link className="button secondary small" href={`/members/${id}?view=membership`}>Back to membership</Link>
    </header>
    <Feedback error={error}/>
    <section className="collection-plan-summary" aria-label="Membership payment summary">
      <h2>{charge.memberships.plan_name}</h2>
      <p className="muted">{formatDisplayDate(charge.memberships.starts_on)} - {formatDisplayDate(charge.memberships.expires_on)}</p>
      <dl className="member-summary-strip">
        <div><dt>Plan total</dt><dd>{formatInr(Number(charge.total_paise))}</dd></div>
        <div><dt>Already paid</dt><dd>{formatInr(paid)}</dd></div>
        <div><dt>Outstanding</dt><dd className={balance > 0 ? "member-balance-due" : "member-balance-settled"}>{formatInr(balance)}</dd></div>
      </dl>
    </section>
    {balance > 0 ? <CollectPaymentForm memberId={id} chargeId={charge.id} balancePaise={balance} today={today} handlers={handlerData.handlers} defaultHandlerId={handlerData.defaultHandlerId} action={collectPayments}/> : <div className="collection-settled"><strong>This membership is fully paid.</strong><Link className="button secondary small" href={`/members/${id}/qr`}>View receipts</Link></div>}
  </div>;
}
