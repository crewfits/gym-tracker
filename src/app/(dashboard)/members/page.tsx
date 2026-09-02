import Link from "next/link";
import Image from "next/image";
import { ArrowDownToLine, Pencil, Plus, QrCode, RefreshCw } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, memberOperationalView } from "@/lib/domain";
import { Feedback } from "@/components/feedback";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";
import { issueMemberQr } from "@/app/actions/attendance";
import { signedMemberPhotoUrls } from "@/lib/member-photo";

const pageSize = 50;
const allowedStatuses = new Set(["active", "expiring", "expired", "upcoming", "not_enrolled", "outstanding", "qr_not_generated", "qr_not_shared", "qr_shared", "qr_disabled", "archived", "all"]);
const memberSorts = new Set(["created_at", "name", "expires_on", "balance", "status"]);

type MemberDirectoryRow = {
  id: string;
  member_code: string;
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
};
type MembershipDisplayRow = { id: string; member_id: string; plan_name: string; starts_on: string; expires_on: string; created_at: string; reverted_at: string | null };

export default async function Members({ searchParams }: PageProps<"/members">) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const requestedStatus = typeof params.status === "string" ? params.status : "";
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "";
  const sort = typeof params.sort === "string" && memberSorts.has(params.sort) ? params.sort : "created_at";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "desc";
  const today = businessDate(gym.timezone);
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
  const rows = (data ?? []) as MemberDirectoryRow[];
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
  const total = Number(rows[0]?.total_count ?? 0);
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
    <div className="page-head"><div><p className="eyebrow">Directory</p><h1>Members</h1><p className="muted">Search, review and take action across the full member history.</p></div><div className="page-actions"><a className="button secondary" href={refreshHref}><RefreshCw size={16}/> Refresh</a><a className="button secondary" href={`/api/exports/members?${exportQuery.toString()}`}><ArrowDownToLine size={16}/> Export this view</a><Link className="button" href="/members/new"><Plus size={17}/> Add member</Link></div></div>
    <Feedback success={success} error={error}/>
    <form className="toolbar">{sort !== "created_at" && <input type="hidden" name="sort" value={sort}/>} {(sort !== "created_at" || order !== "desc") && <input type="hidden" name="order" value={order}/>}<input className="search" name="q" defaultValue={q} maxLength={100} placeholder="Search name, phone or member ID"/><select className="search" name="status" defaultValue={status}><option value="">Current roster</option><option value="active">Active</option><option value="expiring">Expiring</option><option value="expired">Expired</option><option value="upcoming">Upcoming</option><option value="not_enrolled">Not enrolled</option><option value="outstanding">Outstanding</option><option value="qr_not_generated">QR not generated</option><option value="qr_not_shared">QR not shared</option><option value="qr_shared">QR shared</option><option value="qr_disabled">QR disabled</option><option value="archived">Archived members</option><option value="all">All current and archived</option></select><button className="button secondary">Filter</button></form>
    <div className="card table-wrap members-table-card"><table className="table"><thead><tr><SortableTableHeader label="Member" href={hrefForSort("name", "asc")} active={sort === "name"} order={order}/><th>Contact</th><th>Plan</th><SortableTableHeader label="Plan end" href={hrefForSort("expires_on", "asc")} active={sort === "expires_on"} order={order}/><SortableTableHeader label="Balance" href={hrefForSort("balance", "desc")} active={sort === "balance"} order={order}/><SortableTableHeader label="Status" href={hrefForSort("status", "asc")} active={sort === "status"} order={order}/><th>QR</th><th>Actions</th></tr></thead><tbody>{rows.map((member) => {
      const effectiveView = effectiveByMember.get(member.id);
      const effectiveMembership = effectiveView?.membership;
      const displayStatus = member.is_archived ? "archived" : effectiveView?.status ?? member.membership_status;
      const photoUrl = photoUrls.get(member.profile_photo_path ?? "") ?? null;
      const qrStatus = member.is_archived ? "—" : !member.qr_version ? "not generated" : !member.qr_enabled ? "disabled" : member.qr_shared_at ? "shared" : "not shared";
      const qrBadgeClass = !member.qr_version || !member.qr_enabled ? "expired" : member.qr_shared_at ? "active" : "expiring";
      return <tr key={member.id}><td><Link className="member-cell" href={`/members/${member.id}`}><span className="member-avatar small">{photoUrl ? <Image src={photoUrl} alt="" width={38} height={38} unoptimized/> : member.name.slice(0, 1).toUpperCase()}</span><span><strong>{member.name}</strong><br/><small className="muted">{member.member_code}</small></span></Link></td><td>{member.phone}<br/><small className="muted">{member.email ?? "—"}</small></td><td>{effectiveMembership?.plan_name ?? member.plan_name ?? "—"}</td><td>{formatDisplayDate(effectiveMembership?.expires_on ?? member.expires_on)}</td><td>{formatInr(Number(member.balance_paise))}</td><td><span className={`badge ${displayStatus}`}>{displayStatus.replaceAll("_", " ")}</span></td><td><span className={`badge ${qrBadgeClass}`}>{qrStatus}</span></td><td><div className="inline-actions member-row-actions"><Link className="button secondary small" href={`/members/${member.id}#member-details`}><Pencil size={14}/> Edit</Link>{!member.is_archived && <Link className="button secondary small" href={`/members/${member.id}/qr`}><QrCode size={14}/> {member.qr_enabled ? "Share" : "Generate"}</Link>}{!member.is_archived && member.qr_enabled && <ConfirmActionForm action={issueMemberQr} memberId={member.id} message={`Regenerate ${member.name}'s QR? Every old copy will stop working.`} className="button danger small" label="Regenerate" pendingLabel="Regenerating…"/>}</div></td></tr>;
    })}</tbody></table>{!rows.length && <div className="empty">No members match this view.</div>}</div>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 members"}</span><div>{page > 1 && <Link className="button secondary small" href={pageHref(page - 1)}>Previous</Link>}{page < pages && <Link className="button secondary small" href={pageHref(page + 1)}>Next</Link>}</div></div>
  </>;
}
