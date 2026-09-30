import { NextResponse } from "next/server";
import { subDays } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate, formatDate, memberOperationalView } from "@/lib/domain";
import { sendMembershipReminderEmail } from "@/lib/member-email";

type GymRow = { id: string; name: string; email: string | null; phone: string | null; timezone: string; currency_code: string | null };
type MembershipRow = { id: string; plan_name: string; starts_on: string; expires_on: string; created_at: string; reverted_at: string | null };
type MemberRow = { id: string; member_code: string; name: string; email: string | null; is_archived: boolean; memberships: MembershipRow[] | null };

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configuredSecret = process.env.EMAIL_REMINDER_JOB_SECRET;
  const bearerSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const suppliedSecret = request.headers.get("x-fitkiro-job-secret") ?? bearerSecret ?? new URL(request.url).searchParams.get("secret");
  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized reminder job" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: gyms, error: gymError } = await admin.from("gyms").select("id,name,email,phone,timezone,currency_code").eq("is_active", true).returns<GymRow[]>();
  if (gymError) throw gymError;

  const result = { gyms: gyms?.length ?? 0, sent: 0, skipped: 0, failed: 0 };
  for (const gym of gyms ?? []) {
    const today = businessDate(gym.timezone || "Asia/Kolkata");
    const expiredOn = formatDate(subDays(new Date(`${today}T00:00:00Z`), 1));
    const { data: members, error: memberError } = await admin
      .from("members")
      .select("id,member_code,name,email,is_archived,memberships(id,plan_name,starts_on,expires_on,created_at,reverted_at)")
      .eq("gym_id", gym.id)
      .eq("is_archived", false)
      .not("email", "is", null)
      .returns<MemberRow[]>();
    if (memberError) throw memberError;

    for (const member of members ?? []) {
      if (!member.email) continue;
      const operational = memberOperationalView((member.memberships ?? []).filter((membership) => !membership.reverted_at), today);
      if (!operational.membership) continue;
      const kind = operational.status === "expired" && operational.membership.expires_on === expiredOn
        ? "membership_expired"
        : operational.status === "expiring"
          ? "membership_expiring"
          : null;
      if (!kind) continue;
      try {
        const delivery = await sendMembershipReminderEmail(admin, {
          gym,
          member: { id: member.id, member_code: member.member_code, name: member.name, email: member.email },
          membership: { id: operational.membership.id, plan_name: operational.membership.plan_name, expires_on: operational.membership.expires_on },
          kind,
        });
        if (delivery.skipped) result.skipped += 1;
        else result.sent += 1;
      } catch {
        result.failed += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
