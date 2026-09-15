import Link from "next/link";
import { enrollWithPayments } from "@/app/actions/split-payments";
import { MembershipForm } from "@/components/membership-form";
import { requirePermission } from "@/lib/auth";
import { businessDate, normalizeCurrencyCode } from "@/lib/domain";
import { loadStaffHandlers } from "@/lib/staff-handlers";
import type { Plan } from "@/lib/types";

export default async function Enroll({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, query, { supabase, gym, user }] = await Promise.all([params, searchParams, requirePermission("payments.manage")]);
  const [{ data: plans }, handlerData] = await Promise.all([
    supabase.from("plans").select("*").eq("gym_id", gym.id).eq("is_active", true).order("name"),
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
      handlers={handlerData.handlers}
      defaultHandlerId={handlerData.defaultHandlerId}
      action={enrollWithPayments}
      today={businessDate(gym.timezone)}
      currencyCode={normalizeCurrencyCode(gym.currency_code)}
      error={query.error}
    />
  </>;
}
