import Link from "next/link";
import { enrollWithPayments } from "@/app/actions/split-payments";
import { MembershipForm } from "@/components/membership-form";
import { requirePermission } from "@/lib/auth";
import { businessDate } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { loadStaffHandlers } from "@/lib/staff-handlers";
import type { Plan, TrainerOption } from "@/lib/types";

export default async function Enroll({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, query, { supabase, gym, user, viewer }] = await Promise.all([params, searchParams, requirePermission("payments.manage")]);
  const showTrainerAssignment = canAccess(viewer, "trainer.assign", "trainer_assignment");
  const [{ data: plans }, { data: trainers }, { data: member }, handlerData] = await Promise.all([
    supabase.from("plans").select("*").eq("gym_id", gym.id).eq("is_active", true).order("name"),
    showTrainerAssignment ? supabase.from("gym_users").select("id,display_name").eq("gym_id", gym.id).eq("role", "trainer").eq("status", "active").order("display_name") : Promise.resolve({ data: [] }),
    supabase.from("members").select("assigned_trainer_user_id").eq("id", id).eq("gym_id", gym.id).maybeSingle(),
    loadStaffHandlers(supabase, gym.id, user.id),
  ]);
  return <>
    <div className="page-head">
      <div><p className="eyebrow">New membership</p><h1>Enroll member</h1><p className="muted">Choose a plan, membership period and opening payment.</p></div>
      <Link className="button secondary" href={`/members/${id}`}>Cancel</Link>
    </div>
    <MembershipForm
      memberId={id}
      plans={(plans ?? []) as Plan[]}
      trainers={(trainers ?? []) as TrainerOption[]}
      showTrainerAssignment={showTrainerAssignment}
      handlers={handlerData.handlers}
      defaultHandlerId={handlerData.defaultHandlerId}
      defaultTrainerId={member?.assigned_trainer_user_id ?? null}
      action={enrollWithPayments}
      today={businessDate(gym.timezone)}
      error={query.error}
    />
  </>;
}
