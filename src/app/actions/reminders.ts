"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireGym } from "@/lib/auth";
import { formatInr } from "@/lib/domain";
import { renderReminderTemplate, whatsappNumber } from "@/lib/reminders";
import { processAutomaticPaymentReminders } from "@/lib/automatic-reminders";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  redirect(`/reminders?error=${encodeURIComponent(message)}`);
}

export async function openWhatsAppReminder(formData: FormData): Promise<{ url?: string; error?: string }> {
  try {
    const input = z.object({
      kind: z.enum(["payment", "renewal"]),
      member_id: z.uuid(),
      membership_id: z.uuid(),
      charge_id: z.union([z.uuid(), z.literal("")]),
    }).parse(Object.fromEntries(formData));
    const { supabase, user, gym } = await requireGym();
    const { data: member, error: memberError } = await supabase.from("members").select("id,name,phone,is_archived").eq("id", input.member_id).eq("gym_id", gym.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.is_archived) throw new Error("Active member not found");

    const { data: membership, error: membershipError } = await supabase.from("memberships").select("id,plan_name,expires_on").eq("id", input.membership_id).eq("member_id", member.id).eq("gym_id", gym.id).maybeSingle();
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
        balance: formatInr(Number(charge.balance_paise)),
        due_date: charge.due_on,
      });
    } else {
      message = renderReminderTemplate(gym.renewal_reminder_template, {
        name: member.name,
        gym_name: gym.name,
        plan_name: membership.plan_name,
        expiry_date: membership.expires_on,
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
    return { url: `https://wa.me/${number}?text=${encodeURIComponent(message)}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runAutomaticPaymentReminders() {
  let message = "";
  try {
    const { gym } = await requireGym();
    const result = await processAutomaticPaymentReminders(gym.id);
    message = `WhatsApp run complete: ${result.sent} submitted, ${result.skipped} skipped, ${result.failed} failed.`;
  } catch (error) {
    fail(error);
  }
  redirect(`/reminders?success=${encodeURIComponent(message)}`);
}
