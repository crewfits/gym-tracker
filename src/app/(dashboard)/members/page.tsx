import Link from "next/link";
import Image from "next/image";
import { ArrowDownToLine, Plus, RefreshCw, Share2, UserRoundPen } from "lucide-react";
import { issueMemberQr } from "@/app/actions/attendance";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { Feedback } from "@/components/feedback";
import { Pagination } from "@/components/pagination";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";
import { requireGym } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, memberOperationalView, normalizeCurrencyCode } from "@/lib/domain";
import { signedMemberPhotoUrls } from "@/lib/member-photo";
import { canAccess } from "@/lib/permissions";

const pageSize = 10;
const allowedStatuses = new Set(["active", "expiring", "expired", "upcoming", "not_enrolled", "outstanding", "qr_not_generated", "qr_not_shared", "qr_shared", "qr_disabled", "archived", "all", "visited_this_week", "slipping", "visited_last_week"]);
const engagementStatuses = new Set(["visited_this_week", "slipping", "visited_last_week"]);
const memberSorts = new Set(["created_at", "member_code", "old_member_id", "name", "expires_on", "balance", "status"]);

type MemberDirectoryRow = {
  id: string;
  member_code: string;
  old_member_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  profile_photo_path: string | null;
  is_archived: boolean;
  membership_id: string | null;
  plan_name: string | null;
  starts_on: string | null;
  expires_on: string | null;
  membership_status: string;
  balance_paise: number;
  qr_version: number | null;
  qr_enabled: boolean;
  qr_shared_at: string | null;
  total_count: number;
  created_at?: string;
};
type MembershipDisplayRow = { id: string; member_id: string; plan_name: string; starts_on: string; expires_on: string; created_at: string; reverted_at: string | null };
type AttendanceMemberEvent = { member_id: string; occurred_at: string };

export default async function Members({ searchParams }: PageProps<"/members">) {
  const params = await searchParams;
  const { supabase, gym, viewer } = await requireGym();
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const requestedStatus = typeof params.status === "string" ? params.status : "";
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "";
  const sort = typeof params.sort === "string" && memberSorts.has(params.sort) ? params.sort : "created_at";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "desc";
  const today = businessDate(gym.timezone);
  const weekStart = startOfWeek(today);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekStart, -1);
  let rows: MemberDirectoryRow[] = [];
  let total = 0;

  if (engagementStatuses.has(status)) {
    const [activeRows, expiringRows, { data: attendanceRows, error: attendanceError }] = await Promise.all([
      fetchAllMembers(supabase, { q, status: "active", today, sort, order }),
      fetchAllMembers(supabase, { q, status: "expiring", today, sort, order }),
      supabase.from("attendance_events").select("member_id,occurred_at").eq("gym_id", gym.id).eq("direction", "entry").is("voided_at", null).gte("occurred_at", `${addDays(previousWeekStart, -1)}T00:00:00.000Z`).lte("occurred_at", `${addDays(today, 2)}T00:00:00.000Z`),
    ]);
    if (attendanceError) throw attendanceError;
    const rosterById = new Map([...activeRows, ...expiringRows].map((member) => [member.id, member]));
    const currentVisitors = visitorSet((attendanceRows ?? []) as AttendanceMemberEvent[], weekStart, undefined, gym.timezone);
    const previousVisitors = visitorSet((attendanceRows ?? []) as AttendanceMemberEvent[], previousWeekStart, previousWeekEnd, gym.timezone);
    const allFiltered = sortMembers([...rosterById.values()].filter((member) => status === "visited_this_week" ? currentVisitors.has(member.id) : status === "slipping" ? !currentVisitors.has(member.id) : previousVisitors.has(member.id)), sort, order);
    total = allFiltered.length;
    rows = allFiltered.slice((page - 1) * pageSize, page * pageSize).map((member) => ({ ...member, total_count: total }));
  } else {
    const { data, error: loadError } = await supabase.rpc("list_members", {
      p_query: q || null,
      p_status: status || null,
      p_today: today,
      p_page: page,
      p_page_size: pageSize,
      p_sort: sort,
      p_order: order,
    });
    if (loadError) throw loadError;
    rows = (data ?? []) as MemberDirectoryRow[];
    total = Number(rows[0]?.total_count ?? 0);
  }

  const memberIds = rows.map((member) => member.id);
  const [{ data: membershipRows }, photoUrls] = await Promise.all([
    memberIds.length ? supabase.from("memberships").select("id,member_id,plan_name,starts_on,expires_on,created_at,reverted_at").eq("gym_id", gym.id).in("member_id", memberIds).is("reverted_at", null) : Promise.resolve({ data: [] }),
    signedMemberPhotoUrls(supabase, rows.map((member) => member.profile_photo_path)),
  ]);
  const membershipsByMember = new Map<string, MembershipDisplayRow[]>();
  for (const membership of (membershipRows ?? []) as MembershipDisplayRow[]) {
    membershipsByMember.set(membership.member_id, [...(membershipsByMember.get(membership.member_id) ?? []), membership]);
  }
  const effectiveByMember = new Map([...membershipsByMember].map(([memberId, memberMemberships]) => [memberId, memberOperationalView(memberMemberships, today)]));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  const queryFor = ({ targetPage, nextSort, nextOrder }: { targetPage?: number; nextSort?: string; nextOrder?: SortOrder } = {}) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    const selectedSort = nextSort ?? sort;
    const selectedOrder = nextOrder ?? order;
    if (selectedSort !== "created_at") query.set("sort", selectedSort);
    if (selectedSort !== "created_at" || selectedOrder !== "desc") query.set("order", selectedOrder);
    if (targetPage && targetPage > 1) query.set("page", String(targetPage));
    return query;
  };
  const hrefForSort = (field: string, firstOrder: SortOrder) => {
    if (sort === field && order !== firstOrder) return `/members?${queryFor({ nextSort: "created_at", nextOrder: "desc" }).toString()}`.replace(/\?$/, "");
    const nextOrder = sort === field ? (order === "asc" ? "desc" : "asc") : firstOrder;
    return `/members?${queryFor({ nextSort: field, nextOrder }).toString()}`;
  };
  const pageHref = (targetPage: number) => `/members?${queryFor({ targetPage }).toString()}`.replace(/\?$/, "");
  const exportQuery = queryFor();
  const currentQuery = queryFor();
  const refreshHref = `/members?${currentQuery.toString()}`.replace(/\?$/, "");

  return <>
    <div className="page-head">
      <div><p className="eyebrow">Directory</p><h1>Members</h1><p className="muted">Search, review and take action across the full member history.</p></div>
      <div className="page-actions"><a className="button secondary" href={refreshHref}><RefreshCw size={16}/> Refresh</a>{canAccess(viewer, "exports.members", "csv_exports") && <a className="button secondary" href={`/api/exports/members?${exportQuery.toString()}`}><ArrowDownToLine size={16}/> Export this view</a>}{canAccess(viewer, "members.create") && <Link className="button" href="/members/new"><Plus size={17}/> Add member</Link>}</div>
    </div>
    <Feedback success={success} error={error}/>
    <form className="toolbar members-toolbar">
      {sort !== "created_at" && <input type="hidden" name="sort" value={sort}/>}
      {(sort !== "created_at" || order !== "desc") && <input type="hidden" name="order" value={order}/>}
      <input className="search" name="q" defaultValue={q} maxLength={100} placeholder="Search name, phone, FitKiro ID or member ID"/>
      <select className="search" name="status" defaultValue={status}>
        <option value="">Current roster</option><option value="active">Active</option><option value="expiring">Expiring</option><option value="expired">Expired</option><option value="upcoming">Upcoming</option><option value="not_enrolled">Not enrolled</option><option value="outstanding">Outstanding</option><option value="visited_this_week">Visited this week</option><option value="slipping">Slipping this week</option><option value="visited_last_week">Visited last week</option><option value="qr_not_generated">QR not generated</option><option value="qr_not_shared">QR not shared</option><option value="qr_shared">QR shared</option><option value="qr_disabled">QR disabled</option><option value="archived">Archived members</option><option value="all">All current and archived</option>
      </select>
      <button className="button secondary">Filter</button>
    </form>
    <div className="card table-wrap members-table-card">
      <table className="table">
        <colgroup><col className="member-column-id"/><col className="member-column-old-id"/><col className="member-column-name"/><col className="member-column-contact"/><col className="member-column-plan"/><col className="member-column-expiry"/><col className="member-column-balance"/><col className="member-column-status"/><col className="member-column-qr"/><col className="member-column-actions"/></colgroup>
        <thead><tr><SortableTableHeader label="FitKiro ID" href={hrefForSort("member_code", "asc")} active={sort === "member_code"} order={order}/><SortableTableHeader label="Member ID" href={hrefForSort("old_member_id", "asc")} active={sort === "old_member_id"} order={order}/><SortableTableHeader label="Member" href={hrefForSort("name", "asc")} active={sort === "name"} order={order}/><th>Contact</th><th>Plan</th><SortableTableHeader label="Plan end" href={hrefForSort("expires_on", "asc")} active={sort === "expires_on"} order={order}/><SortableTableHeader label="Balance" href={hrefForSort("balance", "desc")} active={sort === "balance"} order={order}/><SortableTableHeader label="Status" href={hrefForSort("status", "asc")} active={sort === "status"} order={order}/><th>QR</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((member) => {
          const effectiveView = effectiveByMember.get(member.id);
          const effectiveMembership = effectiveView?.membership;
          const displayStatus = member.is_archived ? "archived" : effectiveView?.status ?? member.membership_status;
          const photoUrl = photoUrls.get(member.profile_photo_path ?? "") ?? null;
          const qrStatus = member.is_archived ? "—" : !member.qr_version ? "not generated" : !member.qr_enabled ? "disabled" : member.qr_shared_at ? "shared" : "not shared";
          const qrBadgeClass = !member.qr_version || !member.qr_enabled ? "expired" : member.qr_shared_at ? "active" : "expiring";
          return <tr key={member.id}>
            <td><Link href={`/members/${member.id}`}><strong>{member.member_code}</strong></Link></td>
            <td>{member.old_member_id || "—"}</td>
            <td><Link className="member-cell" href={`/members/${member.id}`}><span className="member-avatar small">{photoUrl ? <Image src={photoUrl} alt="" width={38} height={38} unoptimized/> : member.name.slice(0, 1).toUpperCase()}</span><span className="member-name-copy"><strong title={member.name}>{member.name}</strong></span></Link></td>
            <td><span className="member-contact-phone">{member.phone}</span>{member.email && <small className="muted member-contact-email" title={member.email}>{member.email}</small>}</td>
            <td><span className="member-plan-name" title={effectiveMembership?.plan_name ?? member.plan_name ?? undefined}>{effectiveMembership?.plan_name ?? member.plan_name ?? "—"}</span></td>
            <td>{formatDisplayDate(effectiveMembership?.expires_on ?? member.expires_on)}</td>
            <td>{formatInr(Number(member.balance_paise), currencyCode)}</td>
            <td><span className={`badge ${displayStatus}`}>{displayStatus.replaceAll("_", " ")}</span></td>
            <td><span className={`badge ${qrBadgeClass}`}>{qrStatus}</span></td>
            <td><div className="inline-actions member-row-actions"><Link className="button secondary small member-action-icon" href={`/members/${member.id}`} title="Manage member" aria-label={`Manage ${member.name}`}><UserRoundPen size={16}/></Link>{!member.is_archived && <Link className="button secondary small member-action-icon" href={`/members/${member.id}/qr`} title={member.qr_enabled ? "Share QR pass & receipts" : "Generate QR pass"} aria-label={`${member.qr_enabled ? "Share QR pass and receipts for" : "Generate QR pass for"} ${member.name}`}><Share2 size={16}/></Link>}{!member.is_archived && member.qr_enabled && <ConfirmActionForm action={issueMemberQr} memberId={member.id} message={`Regenerate ${member.name}'s QR? Every old copy will stop working.`} className="button danger small member-action-icon" label={`Regenerate QR for ${member.name}`} icon={<RefreshCw size={16}/>} pendingLabel="Regenerating…"/>}</div></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <div className="empty">No members match this view.</div>}
    </div>
    <Pagination page={page} pages={pages} total={total} label="members" pageSize={pageSize} hrefForPage={pageHref}/>
  </>;
}

async function fetchAllMembers(supabase: Awaited<ReturnType<typeof requireGym>>["supabase"], { q, status, today, sort, order }: { q: string; status: string; today: string; sort: string; order: SortOrder }) {
  const result: MemberDirectoryRow[] = [];
  let page = 1;
  let total = 0;
  do {
    const { data, error } = await supabase.rpc("list_members", {
      p_query: q || null,
      p_status: status,
      p_today: today,
      p_page: page,
      p_page_size: 100,
      p_sort: sort,
      p_order: order,
    });
    if (error) throw error;
    const rows = (data ?? []) as MemberDirectoryRow[];
    result.push(...rows);
    total = Number(rows[0]?.total_count ?? result.length);
    page += 1;
  } while (result.length < total);
  return result;
}

function visitorSet(events: AttendanceMemberEvent[], from: string, to: string | undefined, timezone: string) {
  return new Set(events.filter((event) => {
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(event.occurred_at));
    return localDate >= from && (!to || localDate <= to);
  }).map((event) => event.member_id));
}

function sortMembers(rows: MemberDirectoryRow[], sort: string, order: SortOrder) {
  const direction = order === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => direction * compareMember(left, right, sort));
}

function compareMember(left: MemberDirectoryRow, right: MemberDirectoryRow, sort: string) {
  if (sort === "member_code") return left.member_code.localeCompare(right.member_code);
  if (sort === "old_member_id") return (left.old_member_id ?? "").localeCompare(right.old_member_id ?? "");
  if (sort === "name") return left.name.localeCompare(right.name);
  if (sort === "expires_on") return (left.expires_on ?? "").localeCompare(right.expires_on ?? "");
  if (sort === "balance") return Number(left.balance_paise) - Number(right.balance_paise);
  if (sort === "status") return left.membership_status.localeCompare(right.membership_status);
  return (left.created_at ?? left.member_code).localeCompare(right.created_at ?? right.member_code);
}

function startOfWeek(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
