import Link from "next/link";
import { notFound } from "next/navigation";
import { updatePlan } from "@/app/actions/core";
import { Feedback } from "@/components/feedback";
import { requireGym } from "@/lib/auth";
import { SubmitButton } from "@/components/submit-button";

export default async function EditPlan({ params, searchParams }: PageProps<"/plans/[id]/edit">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, gym } = await requireGym();
  const { data: plan } = await supabase.from("plans").select("*").eq("id", id).eq("gym_id", gym.id).single();
  if (!plan) notFound();
  const error = typeof query.error === "string" ? query.error : undefined;
  return <><div className="page-head"><div><p className="eyebrow">Plan settings</p><h1>Edit {plan.name}</h1><p className="muted">Changes apply to future enrollments and renewals only.</p></div><Link className="button secondary" href="/plans">Cancel</Link></div><Feedback error={error}/><form action={updatePlan} className="card form" style={{ maxWidth: 650 }}><input type="hidden" name="id" value={plan.id}/><div className="field"><label>Plan name</label><input name="name" defaultValue={plan.name} required/></div><div className="form-grid"><div className="field"><label>Duration</label><input type="number" name="duration_value" min="1" defaultValue={plan.duration_value} required/></div><div className="field"><label>Unit</label><select name="duration_unit" defaultValue={plan.duration_unit}><option value="months">Months</option><option value="days">Days</option></select></div></div><div className="field"><label>Standard fee (₹)</label><input type="number" name="fee" min="0" step="0.01" defaultValue={(Number(plan.default_fee_paise) / 100).toFixed(2)} required/></div><SubmitButton className="button" style={{ justifySelf: "start" }} pendingLabel="Saving plan…">Save plan changes</SubmitButton></form></>;
}
