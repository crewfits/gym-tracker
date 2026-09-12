import Link from "next/link";
import { CalendarClock, CreditCard } from "lucide-react";
import { updateChargeDueDate } from "@/app/actions/core";
import { OpenWhatsAppReminderButton } from "@/components/open-whatsapp-reminder-button";
import { SubmitButton } from "@/components/submit-button";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { requireGym } from "@/lib/auth";
import { businessDate, calculatePaymentFollowUpDate, formatDisplayDate, formatInr, normalizeCurrencyCode } from "@/lib/domain";

type FollowUp = {
  id: string; membership_id: string; due_on: string; balance_paise: number;
  memberships: { member_id: string; plan_name: string; starts_on: string; expires_on: string;
    members: { name: string; member_code: string; phone: string } };
};

export async function PaymentFollowUps({ page, upcoming, descending }: { page: number; upcoming: boolean; descending: boolean }) {
  const { supabase, gym } = await requireGym();
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
  const today = businessDate(gym.timezone);
  const pageSize = 50;
  let query = supabase.from("charge_balances")
    .select("id,membership_id,due_on,balance_paise,memberships!inner(member_id,plan_name,starts_on,expires_on,reverted_at,members!inner(name,member_code,phone,is_archived))", { count: "exact" })
    .eq("gym_id", gym.id).gt("balance_paise", 0)
    .is("memberships.reverted_at", null).eq("memberships.members.is_archived", false);
  query = upcoming ? query.gt("due_on", today).lte("due_on", calculatePaymentFollowUpDate(today)) : query.lte("due_on", today);
  const { data, error, count } = await query.order("due_on", { ascending: !descending }).order("id")
    .range((page - 1) * pageSize, page * pageSize - 1).returns<FollowUp[]>();
  if (error) throw error;
  const total = count ?? 0;
  const hrefFor = (targetPage = 1, nextUpcoming = upcoming, nextDescending = descending) => {
    const params = new URLSearchParams({ filter: "payments" });
    if (nextUpcoming) params.set("timing", "upcoming");
    if (nextDescending) params.set("order", "desc");
    if (targetPage > 1) params.set("page", String(targetPage));
    return `/reminders?${params}`;
  };

  return <>
    <nav className="filter-tabs payment-timing-tabs" aria-label="Payment follow-up dates">
      <Link href={hrefFor(1, false)} className={!upcoming ? "active" : ""} aria-current={!upcoming ? "page" : undefined}>Due & overdue</Link>
      <Link href={hrefFor(1, true)} className={upcoming ? "active" : ""} aria-current={upcoming ? "page" : undefined}>Upcoming 7 days</Link>
    </nav>
    <section className="table-wrap payment-follow-up-table"><table className="table">
      <thead><tr><th>Member</th><th>Membership</th><th>Remaining</th><SortableTableHeader label="Follow-up date" href={hrefFor(1, upcoming, !descending)} active order={descending ? "desc" : "asc"}/><th>Actions</th></tr></thead>
      <tbody>{(data ?? []).map((item) => {
        const membership = item.memberships;
        const member = membership.members;
        return <tr key={item.id}>
          <td><Link href={`/members/${membership.member_id}`}><strong>{member.name}</strong><br/><small className="muted">{member.member_code} · {member.phone}</small></Link></td>
          <td>{membership.plan_name}<br/><small className="muted">{formatDisplayDate(membership.starts_on)} - {formatDisplayDate(membership.expires_on)}</small></td>
          <td><strong>{formatInr(Number(item.balance_paise), currencyCode)}</strong></td>
          <td><strong>{formatDisplayDate(item.due_on)}</strong><br/><span className={`badge ${item.due_on < today ? "expired" : "expiring"}`}>{item.due_on < today ? "Overdue" : item.due_on === today ? "Due today" : "Upcoming"}</span></td>
          <td><div className="payment-follow-up-actions">
            <OpenWhatsAppReminderButton kind="payment" memberId={membership.member_id} membershipId={item.membership_id} chargeId={item.id}/>
            <Link className="button secondary small" href={`/members/${membership.member_id}/pay?charge=${item.id}`}><CreditCard size={14}/> Collect payment</Link>
            <details className="follow-up-reschedule"><summary><CalendarClock size={14}/> Reschedule</summary>
              <form action={updateChargeDueDate}>
                <input type="hidden" name="member_id" value={membership.member_id}/><input type="hidden" name="charge_id" value={item.id}/>
                <input type="hidden" name="return_path" value="/reminders?filter=payments"/>
                <label htmlFor={`follow-up-${item.id}`}>Next follow-up</label><input id={`follow-up-${item.id}`} type="date" name="due_on" min={today} defaultValue={item.due_on < today ? today : item.due_on} required/>
                <SubmitButton className="button secondary small" pendingLabel="Updating...">Save date</SubmitButton>
              </form>
            </details>
          </div></td>
        </tr>;
      })}</tbody>
    </table>{!data?.length && <div className="empty">{upcoming ? "No payment follow-ups in the next 7 days." : "No outstanding payments need follow-up today."}</div>}</section>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}` : "0 payment follow-ups"}</span><div>
      {page > 1 && <Link className="button secondary small" href={hrefFor(page - 1)}>Previous</Link>}
      {page * pageSize < total && <Link className="button secondary small" href={hrefFor(page + 1)}>Next</Link>}
    </div></div>
  </>;
}
