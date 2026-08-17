import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditCard, Plus, RefreshCw } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { formatInr, membershipStatus, paymentStatus } from "@/lib/domain";
import { Feedback } from "@/components/feedback";
import { updateMember, voidPayment } from "@/app/actions/core";

type ChargeRow = { id: string; total_paise: number; payments: PaymentRow[] };
type MembershipRow = {
  id: string; plan_name: string; starts_on: string; expires_on: string;
  date_overridden: boolean; charges: ChargeRow | null;
};
type PaymentRow = {
  id: string; charge_id: string; amount_paise: number; method: string;
  paid_on: string; receipt_number: string; voided_at: string | null; void_reason: string | null; created_at: string;
};

export default async function MemberDetail({ params, searchParams }: PageProps<"/members/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, gym } = await requireGym();
  const { data } = await supabase.from("members").select("*, memberships(*, charges(*, payments(*)))").eq("id", id).eq("gym_id", gym.id).single();
  if (!data) notFound();
  const member = data as typeof data & { memberships: MembershipRow[] };
  const memberships = [...(member.memberships ?? [])].sort((a, b) => b.expires_on.localeCompare(a.expires_on));
  const payments = memberships.flatMap((membership) => membership.charges?.payments ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: gym.timezone }).format(new Date());
  const enriched = memberships.map((membership) => {
    const charge = membership.charges;
    const paid = payments.filter((payment) => payment.charge_id === charge?.id && !payment.voided_at).reduce((sum, payment) => sum + Number(payment.amount_paise), 0);
    return { ...membership, charge, paid, balance: Number(charge?.total_paise ?? 0) - paid };
  });
  const latest = enriched[0];
  const success = typeof query.success === "string" ? query.success : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;

  return <>
    <div className="page-head"><div><p className="eyebrow">{member.member_code}</p><h1>{member.name}</h1><p className="muted">{member.phone}{member.email ? ` · ${member.email}` : ""}</p></div><div style={{ display: "flex", gap: 8 }}>{!latest && <Link className="button" href={`/members/${id}/enroll`}><Plus size={16}/> Enroll</Link>}{latest && <Link className="button" href={`/members/${id}/renew`}><RefreshCw size={16}/> Renew</Link>}</div></div>
    <Feedback success={success} error={error}/>
    <div className="grid-2"><section className="stack">
      <div className="card"><h2>Membership history</h2><div className="timeline" style={{ marginTop: 22 }}>{enriched.map((membership) => {
        const status = membershipStatus(membership.starts_on, membership.expires_on, today);
        const paidStatus = paymentStatus(Number(membership.charge?.total_paise ?? 0), membership.paid);
        return <div className="timeline-item" key={membership.id}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div><strong>{membership.plan_name}</strong> <span className={`badge ${status}`}>{status}</span><p className="muted">{membership.starts_on} — {membership.expires_on}{membership.date_overridden ? " · custom expiry" : ""}</p><small>Charge {formatInr(Number(membership.charge?.total_paise ?? 0))} · <span className={`badge ${paidStatus}`}>{paidStatus}</span></small></div>{membership.charge && membership.balance > 0 && <Link className="button small" href={`/members/${id}/pay?charge=${membership.charge.id}`}><CreditCard size={14}/> Pay {formatInr(membership.balance)}</Link>}</div></div>;
      })}{!enriched.length && <div className="empty">No membership yet.</div>}</div></div>
      <div className="card"><h2>Payment history</h2><div className="table-wrap"><table className="table"><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Amount</th><th></th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} style={{ opacity: payment.voided_at ? .6 : 1 }}><td><Link href={`/receipts/${payment.id}`}><strong>{payment.receipt_number}</strong></Link>{payment.voided_at && <><br/><small className="muted">Voided: {payment.void_reason}</small></>}</td><td>{payment.paid_on}</td><td>{payment.method.replace("_", " ")}</td><td>{formatInr(Number(payment.amount_paise))}</td><td>{!payment.voided_at && <form action={voidPayment} style={{ display: "flex", gap: 5 }}><input type="hidden" name="payment_id" value={payment.id}/><input type="hidden" name="member_id" value={id}/><input className="search" style={{ padding: 6 }} name="reason" required placeholder="Void reason"/><button className="button danger small">Void</button></form>}</td></tr>)}</tbody></table>{!payments.length && <div className="empty">No payments recorded.</div>}</div></div>
    </section><aside className="stack">
      <form action={updateMember} className="card form"><input type="hidden" name="id" value={id}/><h2>Member details</h2><div className="field"><label>Name</label><input name="name" defaultValue={member.name} required/></div><div className="field"><label>Phone</label><input name="phone" defaultValue={member.phone} required/></div><div className="field"><label>Email</label><input type="email" name="email" defaultValue={member.email ?? ""}/></div><div className="field"><label>Notes</label><textarea name="notes" defaultValue={member.notes ?? ""}/></div><label><input type="checkbox" name="is_archived" defaultChecked={member.is_archived}/> Archive member</label><button className="button secondary">Save changes</button></form>
      {latest && <div className="card"><span className="metric-label">Current outstanding</span><div className="metric">{formatInr(enriched.reduce((sum, membership) => sum + membership.balance, 0))}</div></div>}
    </aside></div>
  </>;
}
