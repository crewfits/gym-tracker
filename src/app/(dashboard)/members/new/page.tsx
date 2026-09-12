import Link from "next/link";
import { activateWithPayments } from "@/app/actions/split-payments";
import { NewMemberForm } from "@/components/new-member-form";
import { requirePermission } from "@/lib/auth";
import { businessDate, normalizeCurrencyCode } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { loadStaffHandlers } from "@/lib/staff-handlers";
import type { Plan, TrainerOption } from "@/lib/types";

export default async function NewMember({ searchParams }: PageProps<"/members/new">) {
  const [params, { supabase, gym, user, viewer }] = await Promise.all([searchParams, requirePermission("members.create")]);
  const showTrainerAssignment = canAccess(viewer, "trainer.assign", "trainer_assignment");
  const [{ data }, { data: trainers }, handlerData] = await Promise.all([
    supabase.from("plans").select("*").eq("gym_id", gym.id).eq("is_active", true).order("name"),
    showTrainerAssignment ? supabase.from("gym_users").select("id,display_name").eq("gym_id", gym.id).eq("role", "trainer").eq("status", "active").order("display_name") : Promise.resolve({ data: [] }),
    loadStaffHandlers(supabase, gym.id, user.id),
  ]);
  const today = businessDate(gym.timezone);
  const error = typeof params.error === "string" ? params.error : undefined;
  return <><div className="page-head"><div><p className="eyebrow">New member</p><h1>Add and enroll member</h1><p className="muted">Create their profile, activate a membership plan, and record the first payment.</p></div><Link className="button secondary" href="/members">Cancel</Link></div><NewMemberForm plans={(data ?? []) as Plan[]} trainers={(trainers ?? []) as TrainerOption[]} showTrainerAssignment={showTrainerAssignment} handlers={handlerData.handlers} defaultHandlerId={handlerData.defaultHandlerId} today={today} currencyCode={normalizeCurrencyCode(gym.currency_code)} error={error} action={activateWithPayments}/></>;
}
