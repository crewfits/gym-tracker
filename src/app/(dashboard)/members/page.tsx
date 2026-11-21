import Link from "next/link";
import Image from "next/image";
import { ArrowDownToLine, Plus, RefreshCw, Share2, UserRoundPen } from "lucide-react";
import { issueMemberQr } from "@/app/actions/attendance";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { Feedback } from "@/components/feedback";
import { MemberSearchFilters } from "@/components/member-search-filters";
import { MemberFilterError, memberFilterRpcArgs, parseMemberFilters, serializeMemberFilters } from "@/lib/member-filters";
import { Pagination } from "@/components/pagination";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";
import { requirePermission } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, normalizeCurrencyCode } from "@/lib/domain";
import { signedMemberPhotoUrls } from "@/lib/member-photo";
import { canAccess } from "@/lib/permissions";

const pageSize = 10;
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
  qr_enabled: boolean;
  total_count: number;
  created_at?: string;
};
export default async function Members({ searchParams }: PageProps<"/members">) {
  const params = await searchParams;
  const { supabase, gym, viewer } = await requirePermission("members.view");
  const currencyCode = normalizeCurrencyCode(gym.currency_code);
  let filters;
  try { filters = parseMemberFilters(params); }
  catch (error) {
    if (!(error instanceof MemberFilterError)) throw error;
    return <><Feedback error={error.message}/><Link className="button secondary" href="/members">Reset search and filters</Link></>;
  }
  const { sort, order } = filters;
  let page = filters.page;
  const today = businessDate(gym.timezone);
  const [{ data, error: loadError }, { data: planRows, error: planError }] = await Promise.all([
    supabase.rpc("search_members", memberFilterRpcArgs(filters, today, pageSize)),
    supabase.rpc("list_member_filter_plans"),
  ]);
  if (loadError) throw loadError;
  if (planError) throw planError;
  let result = data as { rows: MemberDirectoryRow[]; total: number };
  const total = Number(result.total);
  // Count is returned even for an out-of-range page (for example after archival).
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (page > lastPage) {
    page = lastPage;
    const { data, error } = await supabase.rpc("search_members", memberFilterRpcArgs({ ...filters, page }, today, pageSize));
    if (error) throw error;
    result = data as typeof result;
  }
  const rows = result.rows;
  const photoUrls = await signedMemberPhotoUrls(supabase, rows.map((member) => member.profile_photo_path));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  const queryFor = ({ targetPage, nextSort, nextOrder }: { targetPage?: number; nextSort?: string; nextOrder?: SortOrder } = {}) => {
    return serializeMemberFilters({ ...filters, page: targetPage ?? 1, sort: (nextSort ?? sort) as typeof sort, order: nextOrder ?? order });
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
    <MemberSearchFilters key={serializeMemberFilters(filters).toString()} filters={filters} plans={(planRows ?? []).map((row: { plan_name: string }) => row.plan_name)} total={total}/>
    <div className="card table-wrap members-table-card">
      <table className="table">
        <colgroup><col className="member-column-id"/><col className="member-column-old-id"/><col className="member-column-name"/><col className="member-column-contact"/><col className="member-column-plan"/><col className="member-column-expiry"/><col className="member-column-balance"/><col className="member-column-status"/><col className="member-column-actions"/></colgroup>
        <thead><tr><SortableTableHeader label="FitKiro ID" href={hrefForSort("member_code", "asc")} active={sort === "member_code"} order={order}/><SortableTableHeader label="Member ID" href={hrefForSort("old_member_id", "asc")} active={sort === "old_member_id"} order={order}/><SortableTableHeader label="Member" href={hrefForSort("name", "asc")} active={sort === "name"} order={order}/><th>Contact</th><th>Plan</th><SortableTableHeader label="Plan end" href={hrefForSort("expires_on", "asc")} active={sort === "expires_on"} order={order}/><SortableTableHeader label="Balance" href={hrefForSort("balance", "desc")} active={sort === "balance"} order={order}/><SortableTableHeader label="Status" href={hrefForSort("status", "asc")} active={sort === "status"} order={order}/><th>Actions</th></tr></thead>
        <tbody>{rows.map((member) => {
          const displayStatus = member.is_archived ? "archived" : member.membership_status;
          const photoUrl = photoUrls.get(member.profile_photo_path ?? "") ?? null;
          return <tr key={member.id}>
            <td><Link href={`/members/${member.id}`}><strong>{member.member_code}</strong></Link></td>
            <td>{member.old_member_id || "—"}</td>
            <td><Link className="member-cell" href={`/members/${member.id}`}><span className="member-avatar small">{photoUrl ? <Image src={photoUrl} alt="" width={38} height={38} unoptimized/> : member.name.slice(0, 1).toUpperCase()}</span><span className="member-name-copy"><strong title={member.name}>{member.name}</strong></span></Link></td>
            <td><span className="member-contact-phone">{member.phone}</span>{member.email && <small className="muted member-contact-email" title={member.email}>{member.email}</small>}</td>
            <td><span className="member-plan-name" title={member.plan_name ?? undefined}>{member.plan_name ?? "—"}</span></td>
            <td>{formatDisplayDate(member.expires_on)}</td>
            <td>{formatInr(Number(member.balance_paise), currencyCode)}</td>
            <td><span className={`badge ${displayStatus}`}>{displayStatus.replaceAll("_", " ")}</span></td>
            <td><div className="inline-actions member-row-actions"><Link className="button secondary small member-action-icon" href={`/members/${member.id}`} title="Manage member" aria-label={`Manage ${member.name}`}><UserRoundPen size={16}/></Link>{!member.is_archived && <Link className="button secondary small member-action-icon" href={`/members/${member.id}/qr`} title={member.qr_enabled ? "Share QR pass & receipts" : "Generate QR pass"} aria-label={`${member.qr_enabled ? "Share QR pass and receipts for" : "Generate QR pass for"} ${member.name}`}><Share2 size={16}/></Link>}{!member.is_archived && member.qr_enabled && <ConfirmActionForm action={issueMemberQr} memberId={member.id} message={`Regenerate ${member.name}'s QR? Every old copy will stop working.`} className="button danger small member-action-icon" label={`Regenerate QR for ${member.name}`} icon={<RefreshCw size={16}/>} pendingLabel="Regenerating…"/>}</div></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <div className="empty">No members match this view.</div>}
    </div>
    <Pagination page={page} pages={pages} total={total} label="members" pageSize={pageSize} hrefForPage={pageHref}/>
  </>;
}
