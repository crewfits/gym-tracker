import Link from "next/link";
import { Pencil } from "lucide-react";
import { createPlan, togglePlan } from "@/app/actions/core";
import { requireGym } from "@/lib/auth";
import { formatInr, planDurationDays } from "@/lib/domain";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";
import { SortableTableHeader, type SortOrder } from "@/components/sortable-table-header";

const planSorts = new Set(["default", "name", "duration", "fee", "status"]);

export default async function Plans({ searchParams }: PageProps<"/plans">) {
  const params = await searchParams;
  const { supabase, gym } = await requireGym();
  const { data: plans } = await supabase.from("plans").select("*").eq("gym_id", gym.id).order("is_active", { ascending: false }).order("name");
  const sort = typeof params.sort === "string" && planSorts.has(params.sort) ? params.sort : "default";
  const order: SortOrder = params.order === "asc" || params.order === "desc" ? params.order : "asc";
  const sortedPlans = [...(plans ?? [])].sort((left, right) => {
    if (sort === "default") {
      const statusDifference = Number(right.is_active) - Number(left.is_active);
      if (statusDifference) return statusDifference;
      const durationDifference = planDurationDays(right) - planDurationDays(left);
      if (durationDifference) return durationDifference;
      return left.name.localeCompare(right.name);
    }
    const direction = order === "asc" ? 1 : -1;
    const difference = sort === "name" ? left.name.localeCompare(right.name)
      : sort === "duration" ? planDurationDays(left) - planDurationDays(right)
      : sort === "fee" ? Number(left.default_fee_paise) - Number(right.default_fee_paise)
      : Number(left.is_active) - Number(right.is_active);
    return difference ? difference * direction : left.name.localeCompare(right.name);
  });
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  const hrefForSort = (field: string, firstOrder: SortOrder) => {
    if (sort === field && order !== firstOrder) return "/plans";
    const nextOrder = sort === field ? (order === "asc" ? "desc" : "asc") : firstOrder;
    return `/plans?sort=${field}&order=${nextOrder}`;
  };
  return <><div className="page-head"><div><p className="eyebrow">Catalogue</p><h1>Membership plans</h1><p className="muted">Edit future pricing and duration without changing historical memberships.</p></div></div><Feedback success={success} error={error}/><div className="grid-2"><section className="card table-wrap"><table className="table"><thead><tr><SortableTableHeader label="Plan" href={hrefForSort("name", "asc")} active={sort === "name"} order={order}/><SortableTableHeader label="Duration" href={hrefForSort("duration", "asc")} active={sort === "duration"} order={order}/><SortableTableHeader label="Fee" href={hrefForSort("fee", "desc")} active={sort === "fee"} order={order}/><SortableTableHeader label="Status" href={hrefForSort("status", "desc")} active={sort === "status"} order={order}/><th>Actions</th></tr></thead><tbody>{sortedPlans.map((plan) => <tr key={plan.id}><td><strong>{plan.name}</strong></td><td>{plan.duration_value} {plan.duration_unit}</td><td>{formatInr(Number(plan.default_fee_paise))}</td><td><span className={`badge ${plan.is_active ? "active" : ""}`}>{plan.is_active ? "active" : "archived"}</span></td><td><div style={{ display: "flex", gap: 6 }}><Link className="button secondary small" href={`/plans/${plan.id}/edit`}><Pencil size={14}/> Edit</Link><form action={togglePlan}><input type="hidden" name="id" value={plan.id}/><input type="hidden" name="active" value={String(!plan.is_active)}/><SubmitButton className="button secondary small" pendingLabel={plan.is_active ? "Archiving…" : "Activating…"}>{plan.is_active ? "Archive" : "Activate"}</SubmitButton></form></div></td></tr>)}</tbody></table>{!plans?.length && <div className="empty">Create your first membership plan.</div>}</section><form action={createPlan} className="card form"><h2>Add plan</h2><div className="field"><label>Name</label><input name="name" required placeholder="Monthly"/></div><div className="form-grid"><div className="field"><label>Duration</label><input type="number" name="duration_value" min="1" defaultValue="1" required/></div><div className="field"><label>Unit</label><select name="duration_unit"><option value="months">Months</option><option value="days">Days</option></select></div></div><div className="field"><label>Standard fee (₹)</label><input type="number" name="fee" min="0" step="0.01" required/></div><SubmitButton className="button" pendingLabel="Creating plan…">Create plan</SubmitButton></form></div></>;
}
