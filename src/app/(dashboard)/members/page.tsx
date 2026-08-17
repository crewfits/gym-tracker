import Link from "next/link";
import { Plus } from "lucide-react";
import { requireGym } from "@/lib/auth";
import { formatInr, membershipStatus } from "@/lib/domain";
import { Feedback } from "@/components/feedback";

type MembershipSummary = {
  plan_name: string; starts_on: string; expires_on: string;
  charges: { balance_paise: number } | null;
};

export default async function Members({ searchParams }: PageProps<"/members">) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: gym.timezone }).format(new Date());
  let query = supabase.from("members").select("*, memberships(*, charges:charge_balances(*))").eq("gym_id", gym.id).order("created_at", { ascending: false });
  if (typeof params.q === "string" && params.q) query = query.or(`name.ilike.%${params.q}%,phone.ilike.%${params.q}%,member_code.ilike.%${params.q}%`);
  const { data } = await query;
  const rows = (data ?? []).map((member) => {
    const memberships = (member.memberships ?? []) as MembershipSummary[];
    const latest = [...memberships].sort((a, b) => b.expires_on.localeCompare(a.expires_on))[0];
    const status = latest ? membershipStatus(latest.starts_on, latest.expires_on, today) : "unpaid";
    const balance = memberships.reduce((sum, membership) => sum + Number(membership.charges?.balance_paise ?? 0), 0);
    return { ...member, latest, status, balance };
  }).filter((member) => {
    if (typeof params.status !== "string" || !params.status) return true;
    return params.status === "outstanding" ? member.balance > 0 : member.status === params.status;
  });
  const q = typeof params.q === "string" ? params.q : undefined;
  const statusFilter = typeof params.status === "string" ? params.status : undefined;
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  return <>
    <div className="page-head"><div><p className="eyebrow">Directory</p><h1>Members</h1><p className="muted">Search, review and take action on every member.</p></div><Link className="button" href="/members/new"><Plus size={17}/> Add member</Link></div>
    <Feedback success={success} error={error}/>
    <form className="toolbar"><input className="search" name="q" defaultValue={q} placeholder="Search name, phone or member ID"/><select className="search" name="status" defaultValue={statusFilter ?? ""}><option value="">All statuses</option><option value="active">Active</option><option value="expiring">Expiring</option><option value="expired">Expired</option><option value="outstanding">Outstanding</option></select><button className="button secondary">Filter</button></form>
    <div className="card table-wrap"><table className="table"><thead><tr><th>Member</th><th>Contact</th><th>Plan</th><th>Expiry</th><th>Balance</th><th>Status</th></tr></thead><tbody>{rows.map((member) => <tr key={member.id}><td><Link href={`/members/${member.id}`}><strong>{member.name}</strong><br/><small className="muted">{member.member_code}</small></Link></td><td>{member.phone}<br/><small className="muted">{member.email}</small></td><td>{member.latest?.plan_name ?? "—"}</td><td>{member.latest?.expires_on ?? "—"}</td><td>{formatInr(member.balance)}</td><td><span className={`badge ${member.status}`}>{member.latest ? member.status : "not enrolled"}</span></td></tr>)}</tbody></table>{!rows.length && <div className="empty">No members match this view.</div>}</div>
  </>;
}
