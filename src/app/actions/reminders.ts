"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { businessDate, formatDisplayDate, formatInr, memberOperationalView, normalizeCurrencyCode } from "@/lib/domain";
import { sendMembershipReminderEmail } from "@/lib/member-email";
import { renderReminderTemplate, whatsappNumber } from "@/lib/reminders";

type OpenReminderResult = { ok: true; url: string } | { ok: false; error: string };
type ReminderMembershipRow = { id: string; plan_name: string; starts_on: string; expires_on: string; created_at: string; reverted_at: string | null };
type ReminderMemberRow = { id: string; member_code: string; name: string; email: string | null; is_archived: boolean; memberships: ReminderMembershipRow[] | null };

function feedbackPath(path: string, key: "success" | "error", message: string) {
  const url = new URL(path, "http://localhost");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}${url.hash}`;
}

function finish(path: string, message: string): never {
  revalidatePath("/", "layout");
  redirect(feedbackPath(path, "success", message));
}

function fail(path: string, error: unknown): never {
  if (typeof error === "object" && error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "Could not send email reminders.";
  redirect(feedbackPath(path, "error", message));
}

function safeReminderPath(value: string) {
  return value.startsWith("/reminders") ? value : "/reminders";
}

function reminderEmailKind(status: string) {
  if (status === "expired") return "membership_expired" as const;
  if (status === "expiring") return "membership_expiring" as const;
  return null;
}

export async function openWhatsAppReminder(formData: FormData): Promise<OpenReminderResult> {
  try {
    const input = z.object({
      kind: z.enum(["payment", "renewal"]),
      member_id: z.uuid(),
      membership_id: z.uuid(),
      charge_id: z.union([z.uuid(), z.literal("")]),
    }).parse(Object.fromEntries(formData));
    const { supabase, user, gym } = await requirePermission("reminders.manage");
    const currencyCode = normalizeCurrencyCode(gym.currency_code);
    const { data: member, error: memberError } = await supabase.from("members").select("id,name,phone,is_archived").eq("id", input.member_id).eq("gym_id", gym.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.is_archived) throw new Error("Active member not found");

    const { data: membership, error: membershipError } = await supabase.from("memberships").select("id,plan_name,expires_on").eq("id", input.membership_id).eq("member_id", member.id).eq("gym_id", gym.id).is("reverted_at", null).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) throw new Error("Membership not found");

    let message: string;
    let chargeId: string | null = null;
    if (input.kind === "payment") {
      if (!input.charge_id) throw new Error("Payment reminder charge is required");
      const { data: charge, error: chargeError } = await supabase.from("charge_balances").select("id,membership_id,balance_paise,due_on").eq("id", input.charge_id).eq("gym_id", gym.id).maybeSingle();
      if (chargeError) throw chargeError;
      if (!charge || charge.membership_id !== membership.id || Number(charge.balance_paise) <= 0) throw new Error("This charge no longer has an outstanding balance");
      chargeId = charge.id;
      message = renderReminderTemplate(gym.payment_reminder_template, {
        name: member.name,
        gym_name: gym.name,
        plan_name: membership.plan_name,
        balance: formatInr(Number(charge.balance_paise), currencyCode),
        due_date: formatDisplayDate(charge.due_on),
      });
    } else {
      message = renderReminderTemplate(gym.renewal_reminder_template, {
        name: member.name,
        gym_name: gym.name,
        plan_name: membership.plan_name,
        expiry_date: formatDisplayDate(membership.expires_on),
      });
    }

    const number = whatsappNumber(member.phone, process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91");
    const { error: historyError } = await supabase.from("manual_reminder_events").insert({
      gym_id: gym.id,
      member_id: member.id,
      membership_id: membership.id,
      charge_id: chargeId,
      kind: input.kind,
      status: "opened",
      phone_snapshot: member.phone,
      message_snapshot: message,
      prepared_by: user.id,
    });
    if (historyError) throw historyError;
    return { ok: true, url: `https://wa.me/${number}?text=${encodeURIComponent(message)}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "Could not prepare the reminder. Please try again.";
    return { ok: false, error: message };
  }
}

export async function sendSingleMembershipReminderEmail(formData: FormData) {
  const returnPath = safeReminderPath(String(formData.get("return_path") || "/reminders"));
  try {
    const input = z.object({
      member_id: z.uuid(),
      membership_id: z.uuid(),
      candidate_kind: z.enum(["expired", "expiring"]),
      force_resend: z.literal("1").optional(),
    }).parse(Object.fromEntries(formData));
    const { supabase, gym, user } = await requirePermission("reminders.manage");
    const today = businessDate(gym.timezone);
    const { data: member, error } = await supabase
      .from("members")
      .select("id,member_code,name,email,is_archived,memberships(id,plan_name,starts_on,expires_on,created_at,reverted_at)")
      .eq("id", input.member_id)
      .eq("gym_id", gym.id)
      .maybeSingle<ReminderMemberRow>();
    if (error) throw error;
    if (!member || member.is_archived) throw new Error("Active member not found");
    if (!member.email) throw new Error("This member has no email address");
    const operational = memberOperationalView((member.memberships ?? []).filter((membership) => !membership.reverted_at), today);
    if (!operational.membership || operational.membership.id !== input.membership_id || operational.status !== input.candidate_kind) {
      throw new Error("This reminder is no longer due. Refresh the page.");
    }
    const kind = reminderEmailKind(operational.status);
    if (!kind) throw new Error("This reminder is no longer due. Refresh the page.");
    const delivery = await sendMembershipReminderEmail(supabase, {
      gym,
      member: { id: member.id, member_code: member.member_code, name: member.name, email: member.email },
      membership: { id: operational.membership.id, plan_name: operational.membership.plan_name, expires_on: operational.membership.expires_on },
      kind,
      deliveryMode: "manual",
      forceResend: input.force_resend === "1",
      createdBy: user.id,
    });
    if (delivery.skipped) {
      const url = new URL(returnPath, "http://localhost");
      url.searchParams.set("confirm_email_member", member.id);
      url.searchParams.set("confirm_email_membership", operational.membership.id);
      url.searchParams.set("confirm_email_kind", operational.status);
      if (delivery.sentAt) url.searchParams.set("confirm_email_sent_at", delivery.sentAt);
      url.searchParams.set("confirm_email_to", delivery.toEmail ?? member.email);
      redirect(`${url.pathname}${url.search}`);
    }
    finish(returnPath, input.force_resend === "1" ? "Email reminder resent." : "Email reminder sent.");
  } catch (error) {
    fail(returnPath, error);
  }
}

export async function sendDueEmailReminders() {
  try {
    const { supabase, gym } = await requirePermission("reminders.manage");
    const today = businessDate(gym.timezone);
    const { data: members, error } = await supabase
      .from("members")
      .select("id,member_code,name,email,is_archived,memberships(id,plan_name,starts_on,expires_on,created_at,reverted_at)")
      .eq("gym_id", gym.id)
      .eq("is_archived", false)
      .returns<ReminderMemberRow[]>();
    if (error) throw error;

    const result = { sent: 0, skipped: 0, failed: 0, missingEmail: 0 };
    for (const member of members ?? []) {
      const operational = memberOperationalView((member.memberships ?? []).filter((membership) => !membership.reverted_at), today);
      const kind = reminderEmailKind(operational.status);
      if (!kind || !operational.membership) continue;
      if (!member.email) {
        result.missingEmail += 1;
        continue;
      }
      try {
        const delivery = await sendMembershipReminderEmail(supabase, {
          gym,
          member: { id: member.id, member_code: member.member_code, name: member.name, email: member.email },
          membership: { id: operational.membership.id, plan_name: operational.membership.plan_name, expires_on: operational.membership.expires_on },
          kind,
          deliveryMode: "automatic",
        });
        if (delivery.skipped) result.skipped += 1;
        else result.sent += 1;
      } catch {
        result.failed += 1;
      }
    }
    const message = `Email reminders complete: ${result.sent} sent, ${result.skipped} already sent${result.missingEmail ? `, ${result.missingEmail} missing email` : ""}${result.failed ? `, ${result.failed} failed` : ""}.`;
    finish("/reminders", message);
  } catch (error) {
    fail("/reminders", error);
  }
}

