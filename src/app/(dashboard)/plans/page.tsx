import Link from "next/link";
import { Pencil } from "lucide-react";
import { createPlan, togglePlan } from "@/app/actions/core";
import { requireGym } from "@/lib/auth";
import { formatInr } from "@/lib/domain";
import { Feedback } from "@/components/feedback";

export default async function Plans({ searchParams }: PageProps<"/plans">) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const { data: plans } = await supabase.from("plans").select("*").eq("gym_id", gym.id).order("is_active", { ascending: false }).order("name");
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  return <><div className="page-head"><div><p className="eyebrow">Catalogue</p><h1>Membership plans</h1><p className="muted">Edit future pricing and duration without changing historical memberships.</p></div></div><Feedback success={success} error={error}/><div className="grid-2"><section className="card table-wrap"><table className="table"><thead><tr><th>Plan</th><th>Duration</th><th>Fee</th><th>Status</th><th>Actions</th></tr></thead><tbody>{(plans ?? []).map((plan) => <tr key={plan.id}><td><strong>{plan.name}</strong></td><td>{plan.duration_value} {plan.duration_unit}</td><td>{formatInr(Number(plan.default_fee_paise))}</td><td><span className={`badge ${plan.is_active ? "active" : ""}`}>{plan.is_active ? "active" : "archived"}</span></td><td><div style={{ display: "flex", gap: 6 }}><Link className="button secondary small" href={`/plans/${plan.id}/edit`}><Pencil size={14}/> Edit</Link><form action={togglePlan}><input type="hidden" name="id" value={plan.id}/><input type="hidden" name="active" value={String(!plan.is_active)}/><button className="button secondary small">{plan.is_active ? "Archive" : "Activate"}</button></form></div></td></tr>)}</tbody></table>{!plans?.length && <div className="empty">Create your first membership plan.</div>}</section><form action={createPlan} className="card form"><h2>Add plan</h2><div className="field"><label>Name</label><input name="name" required placeholder="Monthly"/></div><div className="form-grid"><div className="field"><label>Duration</label><input type="number" name="duration_value" min="1" defaultValue="1" required/></div><div className="field"><label>Unit</label><select name="duration_unit"><option value="months">Months</option><option value="days">Days</option></select></div></div><div className="field"><label>Standard fee (₹)</label><input type="number" name="fee" min="0" step="0.01" required/></div><button className="button">Create plan</button></form></div></>;
}
