import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CreditCard, Plus, QrCode, RefreshCw } from "lucide-react";
import { reactivateMember, removeMistakenRenewal, renewMembership, reversePayment, updateChargeDueDate, updateMember } from "@/app/actions/core";
import { Feedback } from "@/components/feedback";
import { MemberPhotoField } from "@/components/member-photo-field";
import { MembershipForm } from "@/components/membership-form";
import { RemoveRenewalButton } from "@/components/remove-renewal-button";
import { ReversePaymentForm } from "@/components/reverse-payment-form";
import { SubmitButton } from "@/components/submit-button";
import { requireGym } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, formatPaymentMethod, memberOperationalView, membershipStatus, paymentStatus } from "@/lib/domain";
import { signedMemberPhotoUrl } from "@/lib/member-photo";
import type { Plan } from "@/lib/types";

type PaymentReversalRow = { id: string; amount_paise: number; reason: string; created_at: string };
type PaymentRow = { id: string; charge_id: string; amount_paise: number; method: string; paid_on: string; receipt_number: string; voided_at: string | null; void_reason: string | null; created_at: string; payment_reversals: PaymentReversalRow[] };
type ChargeRow = { id: string; subtotal_paise: number; discount_paise: number; gst_rate_basis_points: number; tax_paise: number; total_paise: number; due_on: string; payments: PaymentRow[] };
type MembershipRow = { id: string; plan_name: string; starts_on: string; expires_on: string; date_overridden: boolean; reverted_at: string | null; charges: ChargeRow | null };

export default async function MemberDetail({ params, searchParams }: PageProps<"/members/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, gym } = await requireGym();
  const [{ data }, { data: plans }] = await Promise.all([
    supabase.from("members").select("*, memberships(*, charges(*, payments(*, payment_reversals(*))))").eq("id", id).eq("gym_id", gym.id).single(),
    supabase.from("plans").select("*").eq("gym_id", gym.id).eq("is_active", true).order("name"),
  ]);
  if (!data) notFound();

  const member = data as typeof data & { memberships: MembershipRow[] };
  const photoUrl = await signedMemberPhotoUrl(supabase, member.profile_photo_path);
  const allMemberships = [...(member.memberships ?? [])].sort((left, right) => right.expires_on.localeCompare(left.expires_on));
  const memberships = allMemberships.filter((membership) => !membership.reverted_at);
  const payments = allMemberships.flatMap((membership) => membership.charges?.payments ?? []).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const today = businessDate(gym.timezone);
  const reversedFor = (payment: PaymentRow) => payment.payment_reversals.reduce((sum, reversal) => sum + Number(reversal.amount_paise), 0);
  const netFor = (payment: PaymentRow) => payment.voided_at ? 0 : Number(payment.amount_paise) - reversedFor(payment);
  const enriched = memberships.map((membership) => {
    const charge = membership.charges;
    const paid = payments.filter((payment) => payment.charge_id === charge?.id).reduce((sum, payment) => sum + netFor(payment), 0);
    return { ...membership, charge, paid, balance: Number(charge?.total_paise ?? 0) - paid };
  });
  const latest = enriched[0];
  const effective = memberOperationalView(enriched, today);
  const totalOutstanding = enriched.reduce((sum, membership) => sum + membership.balance, 0);
  const success = typeof query.success === "string" ? query.success : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const showReactivation = member.is_archived && query.reactivate === "1";

  return <>
    <Feedback success={success} error={error}/>
    {showReactivation && <div className="alert reactivation-alert">
      <div><strong>This phone belongs to an archived member.</strong><br/><span>Reactivate this profile to preserve its membership, payment and attendance history. Its previous QR will remain invalid.</span></div>
      <form action={reactivateMember}>
        <input type="hidden" name="member_id" value={id}/>
        <SubmitButton className="button" pendingLabel="Reactivating...">Reactivate member</SubmitButton>
      </form>
    </div>}

    <div className="member-layout">
      <div className="member-main-stack">
        <section className="card member-membership">
          <div className="section-head">
            <div className="section-head-copy">
              <h2>Memberships</h2>
              {effective.membership && <span className={`badge ${effective.status}`}>{statusLabel(effective.status)}</span>}
            </div>
            <div className="inline-actions">
              {!member.is_archived && latest && <details className="renewal-disclosure">
                <summary className="button"><RefreshCw size={16}/> Renew membership</summary>
                <div className="renewal-inline">
                  <div className="section-head"><div><h2>Create renewal</h2><span className="muted">Renew and record payment without leaving this member.</span></div></div>
                  <MembershipForm memberId={id} plans={(plans ?? []) as Plan[]} action={renewMembership} today={today} renew currentExpiry={latest.expires_on} error={error} returnPath={`/members/${id}`}/>
                </div>
              </details>}
              {!member.is_archived && !latest && <Link className="button" href={`/members/${id}/enroll`}><Plus size={16}/> Start plan</Link>}
            </div>
          </div>

          <div className="membership-list">
            {enriched.map((membership, membershipIndex) => {
              const status = membershipStatus(membership.starts_on, membership.expires_on, today);
              const paidStatus = paymentStatus(Number(membership.charge?.total_paise ?? 0), membership.paid);
              const charge = membership.charge;
              return <details className="membership-record" key={membership.id} open={membershipIndex === 0}>
                <summary>
                  <span className="membership-record-main">
                    <strong>{membership.plan_name}</strong>
                    <span className="muted">{formatDisplayDate(membership.starts_on)} - {formatDisplayDate(membership.expires_on)}{membership.date_overridden ? " · custom expiry" : ""}</span>
                  </span>
                  <span className="membership-record-meta">
                    <span className={`badge ${status}`}>{statusLabel(status)}</span>
                    {status !== "expired" && <span className={`badge ${paidStatus}`}>{statusLabel(paidStatus)}</span>}
                    {membershipIndex < enriched.length - 1 && <RemoveRenewalButton membershipId={membership.id} memberId={id} action={removeMistakenRenewal}/>}
                  </span>
                </summary>
                <div className={`membership-record-body ${membership.balance > 0 ? "" : "compact"}`}>
                  {charge && <div className="charge-breakdown">
                    <span>Base price<strong>{formatInr(Number(charge.subtotal_paise))}</strong></span>
                    <span>Discount<strong>- {formatInr(Number(charge.discount_paise))}</strong></span>
                    <span>GST ({Number(charge.gst_rate_basis_points) / 100}%)<strong>{formatInr(Number(charge.tax_paise))}</strong></span>
                    <span className="charge-total">Total price<strong>{formatInr(Number(charge.total_paise))}</strong></span>
                    <span>Collected<strong>{formatInr(membership.paid)}</strong></span>
                    <span>Balance<strong>{formatInr(membership.balance)}</strong></span>
                    <form action={updateChargeDueDate} className="inline-date-form">
                      <input type="hidden" name="member_id" value={id}/>
                      <input type="hidden" name="charge_id" value={charge.id}/>
                      <label>Follow-up date <input type="date" name="due_on" defaultValue={charge.due_on} required/></label>
                      <SubmitButton className="button secondary small" pendingLabel="Updating...">Update</SubmitButton>
                    </form>
                  </div>}
                  {charge && membership.balance > 0 && <div className="membership-actions">
                    <Link className="button small collect-button" href={`/members/${id}/pay?charge=${charge.id}`}><CreditCard size={14}/> Collect {formatInr(membership.balance)}</Link>
                  </div>}
                </div>
              </details>;
            })}
            {!enriched.length && <div className="empty">No training plan has been activated yet.</div>}
          </div>
        </section>

        <section className="card member-payments">
          <div className="section-head"><div className="section-head-copy"><h2>Payments</h2><span className="muted">Reversals preserve the original receipt for audit history.</span></div><Link className="text-link" href="/transactions">All transactions <ArrowRight size={15}/></Link></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Amount</th><th>Correction</th></tr></thead>
              <tbody>{payments.map((payment) => <tr key={payment.id} style={{ opacity: payment.voided_at ? .62 : 1 }}>
                <td><Link href={`/receipts/${payment.id}`}><strong>{payment.receipt_number}</strong></Link>{payment.voided_at && <><br/><small className="muted">Reversed: {payment.void_reason}</small></>}</td>
                <td>{formatDisplayDate(payment.paid_on)}</td>
                <td>{formatPaymentMethod(payment.method)}</td>
                <td><strong>{formatInr(netFor(payment))}</strong>{reversedFor(payment) > 0 && <><br/><small className="muted">{formatInr(reversedFor(payment))} reversed</small></>}</td>
                <td>{!payment.voided_at ? <ReversePaymentForm paymentId={payment.id} memberId={id} remainingPaise={Number(payment.amount_paise) - reversedFor(payment)} action={reversePayment}/> : <span className="badge expired">Reversed</span>}</td>
              </tr>)}</tbody>
            </table>
            {!payments.length && <div className="empty">No collection activity yet.</div>}
          </div>
        </section>
      </div>

      <aside className="member-details stack">
        {latest && <div className={`card balance-card ${totalOutstanding > 0 ? "needs-attention" : "settled"}`}>
          <span className="metric-label">Balance to recover</span>
          <div className="metric">{formatInr(totalOutstanding)}</div>
          <small className="muted">Across all membership periods</small>
        </div>}
        <form id="member-details" action={updateMember} className="card form">
          <div className="section-head member-edit-head">
            <div><h2>Edit details</h2><span className="muted">{member.member_code} · {member.phone}{member.email ? ` · ${member.email}` : ""}{member.is_archived ? " · archived" : ""}</span></div>
            {!member.is_archived && <Link className="button secondary small" href={`/members/${id}/qr`}><QrCode size={14}/> QR pass</Link>}
          </div>
          <input type="hidden" name="id" value={id}/>
          <MemberPhotoField existingUrl={photoUrl} memberName={member.name}/>
          <div className="field"><label>Name</label><input name="name" defaultValue={member.name} required/></div>
          <div className="field"><label>Phone</label><input name="phone" defaultValue={member.phone} required/></div>
          <div className="field"><label>Email</label><input type="email" name="email" defaultValue={member.email ?? ""}/></div>
          <div className="field"><label>Coach notes</label><textarea name="notes" rows={4} defaultValue={member.notes ?? ""}/></div>
          <label><input type="checkbox" name="whatsapp_reminders_enabled" defaultChecked={Boolean(member.whatsapp_reminders_enabled)}/> Member agreed to automated WhatsApp payment reminders</label>
          <label><input type="checkbox" name="is_archived" defaultChecked={member.is_archived}/> Move member out of active roster</label>
          <SubmitButton className="button" pendingLabel="Saving profile...">Save profile</SubmitButton>
        </form>
      </aside>
    </div>
  </>;
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
