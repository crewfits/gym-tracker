import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditCard, Plus, RefreshCw, Share2 } from "lucide-react";
import { reactivateMember, removeMistakenRenewal, updateChargeDueDate, updateMember } from "@/app/actions/core";
import { renewWithPayments } from "@/app/actions/split-payments";
import { Feedback } from "@/components/feedback";
import { MemberPhotoField } from "@/components/member-photo-field";
import { MembershipForm } from "@/components/membership-form";
import { MemberWorkspace } from "@/components/member-workspace";
import { RemoveRenewalButton } from "@/components/remove-renewal-button";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, memberOperationalView, membershipStatus, normalizeCurrencyCode, paymentStatus } from "@/lib/domain";
import { signedMemberPhotoUrl } from "@/lib/member-photo";
import { loadStaffHandlers, roleLabel } from "@/lib/staff-handlers";
import type { Plan } from "@/lib/types";

type PaymentReversalRow = { id: string; amount_paise: number; reason: string; created_at: string };
type HandlerRow = { display_name: string | null; role: string };
function handlerName(handler: HandlerRow | HandlerRow[] | null) {
  const row = Array.isArray(handler) ? handler[0] : handler;
  return row ? row.display_name || roleLabel(row.role) : null;
}
type PaymentRow = { id: string; charge_id: string; amount_paise: number; method: string; paid_on: string; receipt_number: string; voided_at: string | null; void_reason: string | null; created_at: string; handled_by_gym_user_id: string | null; handled_by: HandlerRow | HandlerRow[] | null; payment_reversals: PaymentReversalRow[] };
type ChargeRow = { id: string; subtotal_paise: number; discount_paise: number; gst_rate_basis_points: number; tax_paise: number; total_paise: number; due_on: string; payments: PaymentRow[] };
type MembershipRow = { id: string; plan_id: string | null; plan_name: string; starts_on: string; expires_on: string; date_overridden: boolean; reverted_at: string | null; handled_by: HandlerRow | HandlerRow[] | null; charges: ChargeRow | null };

export default async function MemberDetail({ params, searchParams }: PageProps<"/members/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, gym, user } = await requirePermission("members.view");
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
  const [{ data }, { data: plans }, handlerData] = await Promise.all([
    supabase.from("members").select("*, memberships(*, handled_by:gym_users!memberships_handled_by_gym_user_fk(display_name,role), charges(*, payments(*, handled_by:gym_users!payments_handled_by_gym_user_fk(display_name,role), payment_reversals(*))))").eq("id", id).eq("gym_id", gym.id).single(),
    supabase.from("plans").select("*").eq("gym_id", gym.id).eq("is_active", true).order("name"),
    loadStaffHandlers(supabase, gym.id, user.id),
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
  const unpaidMemberships = enriched.filter((membership) => membership.charge && membership.balance > 0)
    .sort((left, right) => left.starts_on.localeCompare(right.starts_on));
  const collectHref = unpaidMemberships.length === 1
    ? `/members/${id}/pay?charge=${unpaidMemberships[0].charge!.id}`
    : "#outstanding-payments";
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

    <div className="member-manage-page">
      <header className="member-manage-head">
        <div><h1>{member.name}</h1><span className="muted">{member.member_code}</span> <span className={`badge ${member.is_archived ? "expired" : effective.status}`}>{member.is_archived ? "Archived" : statusLabel(effective.status)}</span></div>
        {!member.is_archived && <Link className="button secondary" href={`/members/${id}/qr`}><Share2 size={16}/> QR pass & receipts</Link>}
      </header>
      <dl className="member-summary-strip">
        <div><dt>Current plan</dt><dd>{effective.membership?.plan_name ?? "No active plan"}</dd></div>
        <div><dt>Latest expiry</dt><dd>{latest ? formatDisplayDate(latest.expires_on) : "-"}</dd>{!member.is_archived && <dd className="member-summary-action"><Link className="button secondary small" href={latest ? `/members/${id}/renew` : `/members/${id}/enroll`}>{latest ? <RefreshCw size={14}/> : <Plus size={14}/>}{latest ? "Renew membership" : "Start membership"}</Link></dd>}</div>
        <div><dt>Outstanding balance</dt><dd className={totalOutstanding > 0 ? "member-balance-due" : "member-balance-settled"}>{formatInr(totalOutstanding, currencyCode)}</dd>{unpaidMemberships.length > 0 && <dd className="member-summary-action"><Link className="button small" href={collectHref}><CreditCard size={14}/>{unpaidMemberships.length === 1 ? "Collect payment" : "View unpaid plans"}</Link></dd>}</div>
      </dl>
      {unpaidMemberships.length > 0 && <section className="member-outstanding-section" id="outstanding-payments" aria-labelledby="outstanding-heading">
        <h2 id="outstanding-heading">Outstanding payments</h2>
        <div className="member-outstanding-list">{unpaidMemberships.map((membership) => <div className="member-outstanding-row" key={membership.id}>
          <div className="member-outstanding-plan"><strong>{membership.plan_name}</strong><span className="muted">{formatDisplayDate(membership.starts_on)} - {formatDisplayDate(membership.expires_on)}</span><small className="muted">Paid {formatInr(membership.paid, currencyCode)} of {formatInr(Number(membership.charge!.total_paise), currencyCode)}</small></div>
          <div className="member-outstanding-amount"><span className="muted">Remaining</span><strong>{formatInr(membership.balance, currencyCode)}</strong></div>
          <Link className="button secondary small" href={`/members/${id}/pay?charge=${membership.charge!.id}`} aria-label={`Collect ${formatInr(membership.balance, currencyCode)} for ${membership.plan_name}, ${formatDisplayDate(membership.starts_on)} to ${formatDisplayDate(membership.expires_on)}`}><CreditCard size={14}/> Collect payment</Link>
        </div>)}</div>
      </section>}
      <MemberWorkspace key={query.view === "membership" ? "membership" : "profile"} initialView={query.view === "membership" ? "membership" : "profile"} membership={<>
        <section className="member-renewal-section">
          <h2>{latest ? "Renew membership" : "Start membership"}</h2>
          {unpaidMemberships.length > 0 && !member.is_archived && <p className="member-renewal-balance-note">Previous balance: {formatInr(totalOutstanding, currencyCode)}. Renewal payments apply to the new membership period.</p>}
          {!member.is_archived && latest && <MembershipForm memberId={id} plans={(plans ?? []) as Plan[]} action={renewWithPayments} today={today} currencyCode={currencyCode} renew embedded currentExpiry={latest.expires_on} defaultPlanId={latest.plan_id} handlers={handlerData.handlers} defaultHandlerId={handlerData.defaultHandlerId} returnPath={`/members/${id}?view=membership`}/>}
          {!member.is_archived && !latest && <Link className="button" href={`/members/${id}/enroll`}><Plus size={16}/> Start plan</Link>}
          {member.is_archived && <p className="muted">Reactivate this member before renewing their membership.</p>}
        </section>
        <section className="member-history-section">
          <h2>Membership history <span className="muted">({enriched.length})</span></h2>
          <div className="membership-list">
            {enriched.map((membership, membershipIndex) => {
              const status = membershipStatus(membership.starts_on, membership.expires_on, today);
              const paidStatus = paymentStatus(Number(membership.charge?.total_paise ?? 0), membership.paid);
              const charge = membership.charge;
              return <details className="membership-record" key={membership.id}>
                <summary>
                  <span className="membership-record-main">
                    <strong>{membership.plan_name}</strong>
                    <span className="muted">{formatDisplayDate(membership.starts_on)} - {formatDisplayDate(membership.expires_on)}{membership.date_overridden ? " · custom expiry" : ""}{handlerName(membership.handled_by) ? ` · handled by ${handlerName(membership.handled_by)}` : ""}</span>
                  </span>
                  <span className="membership-record-meta">
                    <span className={`badge ${status}`}>{statusLabel(status)}</span>
                    {status !== "expired" && <span className={`badge ${paidStatus}`}>{statusLabel(paidStatus)}</span>}
                    {membershipIndex < enriched.length - 1 && <RemoveRenewalButton membershipId={membership.id} memberId={id} action={removeMistakenRenewal}/>}
                  </span>
                </summary>
                <div className={`membership-record-body ${membership.balance > 0 ? "" : "compact"}`}>
                  {charge && <div className="charge-breakdown">
                    <span>Base price<strong>{formatInr(Number(charge.subtotal_paise), currencyCode)}</strong></span>
                    <span>Discount<strong>- {formatInr(Number(charge.discount_paise), currencyCode)}</strong></span>
                    <span>GST ({Number(charge.gst_rate_basis_points) / 100}%)<strong>{formatInr(Number(charge.tax_paise), currencyCode)}</strong></span>
                    <span className="charge-total">Total price<strong>{formatInr(Number(charge.total_paise), currencyCode)}</strong></span>
                    <span>Collected<strong>{formatInr(membership.paid, currencyCode)}</strong></span>
                    <span>Balance<strong>{formatInr(membership.balance, currencyCode)}</strong></span>
                    <form action={updateChargeDueDate} className="inline-date-form">
                      <input type="hidden" name="member_id" value={id}/>
                      <input type="hidden" name="charge_id" value={charge.id}/>
                      <label>Follow-up date <input type="date" name="due_on" defaultValue={charge.due_on} required/></label>
                      <SubmitButton className="button secondary small" pendingLabel="Updating...">Update</SubmitButton>
                    </form>
                  </div>}
                  {charge && charge.payments.length > 0 && <div className="membership-payment-audit">{charge.payments.map((payment: PaymentRow) => handlerName(payment.handled_by) && <small className="muted" key={payment.id}>{payment.receipt_number} collected by {handlerName(payment.handled_by)}</small>)}</div>}
                  {charge && membership.balance > 0 && <div className="membership-actions">
                    <Link className="button small collect-button" href={`/members/${id}/pay?charge=${charge.id}`}><CreditCard size={14}/> Collect {formatInr(membership.balance, currencyCode)}</Link>
                  </div>}
                </div>
              </details>;
            })}
            {!enriched.length && <div className="empty">No training plan has been activated yet.</div>}
          </div>
        </section>
      </>} profile={<form id="member-details" action={updateMember} className="form member-profile-form">
          <h2>Member details</h2>
          <input type="hidden" name="id" value={id}/>
          <MemberPhotoField existingUrl={photoUrl} memberName={member.name}/>
          <div className="form-grid">
            <div className="field"><label htmlFor="member-name">Full name</label><input id="member-name" name="name" defaultValue={member.name} required/></div>
            <div className="field"><label htmlFor="member-phone">Phone number</label><input id="member-phone" name="phone" type="tel" defaultValue={member.phone} required/></div>
            <div className="field member-field-wide"><label htmlFor="member-email">Email address</label><input id="member-email" type="email" name="email" defaultValue={member.email ?? ""}/></div>
            <div className="field"><label htmlFor="member-old-member-id">Member ID</label><input id="member-old-member-id" name="old_member_id" maxLength={100} defaultValue={member.old_member_id ?? ""} placeholder="From the existing register or system"/></div>
            <div className="field member-field-wide"><label htmlFor="member-notes">Remarks</label><textarea id="member-notes" name="notes" rows={3} defaultValue={member.notes ?? ""}/></div>
          </div>
          <div className="member-preferences">
            <label><input type="checkbox" name="is_archived" defaultChecked={member.is_archived}/> Archive member</label>
          </div>
          <div><SubmitButton className="button" pendingLabel="Saving details...">Save member details</SubmitButton></div>
        </form>}/>
    </div>
  </>;
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
