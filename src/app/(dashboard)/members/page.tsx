import Link from "next/link";
import Image from "next/image";
import { ArrowDownToLine, Pencil, Plus, QrCode } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { businessDate, formatInr } from "@/lib/domain";
import { Feedback } from "@/components/feedback";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { issueMemberQr } from "@/app/actions/attendance";
import { signedMemberPhotoUrls } from "@/lib/member-photo";

const pageSize = 50;
const allowedStatuses = new Set(["active", "expiring", "expired", "upcoming", "not_enrolled", "outstanding", "qr_not_generated", "qr_not_shared", "qr_shared", "qr_disabled", "archived", "all"]);

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

export default async function Members({ searchParams }: PageProps<"/members">) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const requestedStatus = typeof params.status === "string" ? params.status : "";
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "";
  const { data, error: loadError } = await supabase.rpc("list_members", {
    p_query: q || null,
    p_status: status || null,
    p_today: businessDate(gym.timezone),
    p_page: page,
    p_page_size: pageSize,
  });
  if (loadError) throw loadError;
  const rows = (data ?? []) as MemberDirectoryRow[];
  const photoUrls = await signedMemberPhotoUrls(supabase, rows.map((member) => member.profile_photo_path));
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (target > 1) query.set("page", String(target));
    const suffix = query.toString();
    return `/members${suffix ? `?${suffix}` : ""}`;
  };
  const exportQuery = new URLSearchParams();
  if (q) exportQuery.set("q", q);
  if (status) exportQuery.set("status", status);

  return <>
    <div className="page-head"><div><p className="eyebrow">Directory</p><h1>Members</h1><p className="muted">Search, review and take action across the full member history.</p></div><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><a className="button secondary" href={`/api/exports/members?${exportQuery.toString()}`}><ArrowDownToLine size={16}/> Export this view</a><Link className="button" href="/members/new"><Plus size={17}/> Add member</Link></div></div>
    <Feedback success={success} error={error}/>
    <form className="toolbar"><input className="search" name="q" defaultValue={q} maxLength={100} placeholder="Search name, phone or member ID"/><select className="search" name="status" defaultValue={status}><option value="">Current roster</option><option value="active">Active</option><option value="expiring">Expiring</option><option value="expired">Expired</option><option value="upcoming">Upcoming</option><option value="not_enrolled">Not enrolled</option><option value="outstanding">Outstanding</option><option value="qr_not_generated">QR not generated</option><option value="qr_not_shared">QR not shared</option><option value="qr_shared">QR shared</option><option value="qr_disabled">QR disabled</option><option value="archived">Archived members</option><option value="all">All current and archived</option></select><button className="button secondary">Filter</button></form>
    <div className="card table-wrap"><table className="table"><thead><tr><th>Member</th><th>Contact</th><th>Plan</th><th>Plan end</th><th>Balance</th><th>Status</th><th>QR</th><th>Actions</th></tr></thead><tbody>{rows.map((member) => {
      const displayStatus = member.is_archived ? "archived" : member.membership_status;
      const photoUrl = photoUrls.get(member.profile_photo_path ?? "") ?? null;
      const qrStatus = member.is_archived ? "—" : !member.qr_version ? "not generated" : !member.qr_enabled ? "disabled" : member.qr_shared_at ? "shared" : "not shared";
      const qrBadgeClass = !member.qr_version || !member.qr_enabled ? "expired" : member.qr_shared_at ? "active" : "expiring";
      return <tr key={member.id}><td><Link className="member-cell" href={`/members/${member.id}`}><span className="member-avatar small">{photoUrl ? <Image src={photoUrl} alt="" width={38} height={38} unoptimized/> : member.name.slice(0, 1).toUpperCase()}</span><span><strong>{member.name}</strong><br/><small className="muted">{member.member_code}</small></span></Link></td><td>{member.phone}<br/><small className="muted">{member.email ?? "—"}</small></td><td>{member.plan_name ?? "—"}</td><td>{member.expires_on ?? "—"}</td><td>{formatInr(Number(member.balance_paise))}</td><td><span className={`badge ${displayStatus}`}>{displayStatus.replaceAll("_", " ")}</span></td><td><span className={`badge ${qrBadgeClass}`}>{qrStatus}</span></td><td><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}><Link className="button secondary small" href={`/members/${member.id}#member-details`}><Pencil size={14}/> Edit</Link>{!member.is_archived && <Link className="button secondary small" href={`/members/${member.id}/qr`}><QrCode size={14}/> {member.qr_enabled ? "Share" : "Generate"}</Link>}{!member.is_archived && member.qr_enabled && <ConfirmActionForm action={issueMemberQr} memberId={member.id} message={`Regenerate ${member.name}'s QR? Every old copy will stop working.`} className="button danger small" label="Regenerate" pendingLabel="Regenerating…"/>}</div></td></tr>;
    })}</tbody></table>{!rows.length && <div className="empty">No members match this view.</div>}</div>
    <div className="pagination"><span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 members"}</span><div>{page > 1 && <Link className="button secondary small" href={pageHref(page - 1)}>Previous</Link>}{page < pages && <Link className="button secondary small" href={pageHref(page + 1)}>Next</Link>}</div></div>
  </>;
}
