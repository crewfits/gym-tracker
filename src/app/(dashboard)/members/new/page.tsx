import Link from "next/link";
import { createMember } from "@/app/actions/core";
import { NewMemberForm } from "@/components/new-member-form";
import { requireGym } from "@/lib/auth";
import type { Plan } from "@/lib/types";

export default async function NewMember({ searchParams }: PageProps<"/members/new">) {
  const [params, { supabase, gym }] = await Promise.all([searchParams, requireGym()]);
  const { data } = await supabase.from("plans").select("*").eq("gym_id", gym.id).eq("is_active", true).order("name");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: gym.timezone }).format(new Date());
  const error = typeof params.error === "string" ? params.error : undefined;
  return <><div className="page-head"><div><p className="eyebrow">New enrollment</p><h1>Add and enroll member</h1><p className="muted">Create the member, start their plan, and record payment in one step.</p></div><Link className="button secondary" href="/members">Cancel</Link></div><NewMemberForm plans={(data ?? []) as Plan[]} today={today} error={error} action={createMember}/></>;
}
