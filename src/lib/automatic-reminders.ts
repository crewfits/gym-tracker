import "server-only";

import { businessDate, formatDisplayDate, formatInr } from "@/lib/domain";
import { renderReminderTemplate, whatsappNumber } from "@/lib/reminders";
import { createAdminClient } from "@/lib/supabase/admin";

type Gym = { id: string; name: string; timezone: string; payment_reminder_template: string; whatsapp_payment_template_name: string; whatsapp_template_language: string };
type Balance = { id: string; membership_id: string; balance_paise: number; due_on: string };
type Member = { id: string; name: string; phone: string; is_archived: boolean; whatsapp_reminders_enabled: boolean };
type Membership = { id: string; plan_name: string; members: Member | Member[] };
type MetaResponse = { messages?: Array<{ id: string }>; error?: { message?: string; error_user_msg?: string } };
export type ReminderRunResult = { sent: number; skipped: number; failed: number };

export async function processAutomaticPaymentReminders(gymId?: string): Promise<ReminderRunResult> {
  const accessToken = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = requiredEnv("WHATSAPP_GRAPH_API_VERSION");
  const defaultCountryCode = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91";
  const db = createAdminClient();
  let gymQuery = db.from("gyms").select("id,name,timezone,payment_reminder_template,whatsapp_payment_template_name,whatsapp_template_language");
  gymQuery = gymId ? gymQuery.eq("id", gymId) : gymQuery.eq("automatic_payment_whatsapp_enabled", true);
  const { data: gyms, error: gymsError } = await gymQuery;
  if (gymsError) throw gymsError;

  const totals = { sent: 0, skipped: 0, failed: 0 };
  for (const gym of (gyms ?? []) as Gym[]) {
    const today = businessDate(gym.timezone);
    const { data: balances, error: balanceError } = await db.from("charge_balances").select("id,membership_id,balance_paise,due_on").eq("gym_id", gym.id).eq("due_on", today).gt("balance_paise", 0);
    if (balanceError) { totals.failed += 1; continue; }
    const dueBalances = (balances ?? []) as Balance[];
    if (!dueBalances.length) continue;
    const { data: memberships, error: membershipsError } = await db.from("memberships").select("id,plan_name,members!inner(id,name,phone,is_archived,whatsapp_reminders_enabled)").eq("gym_id", gym.id).in("id", dueBalances.map((item) => item.membership_id));
    if (membershipsError) { totals.failed += dueBalances.length; continue; }
    const membershipMap = new Map(((memberships ?? []) as Membership[]).map((membership) => [membership.id, membership]));

    for (const balance of dueBalances) {
      const membership = membershipMap.get(balance.membership_id);
      const member = membership ? first(membership.members) : null;
      if (!membership || !member || member.is_archived) continue;
      const { data: prior } = await db.from("reminder_deliveries").select("id,status").eq("charge_id", balance.id).eq("scheduled_for", today).eq("channel", "whatsapp").maybeSingle();
      if (prior?.status === "sent" || prior?.status === "skipped") continue;

      const balanceText = formatInr(Number(balance.balance_paise));
      const dueDate = formatDisplayDate(balance.due_on);
      const values = { name: member.name, gym_name: gym.name, plan_name: membership.plan_name, balance: balanceText, due_date: dueDate };
      const message = renderReminderTemplate(gym.payment_reminder_template, values);
      let recipient: string | null = null;
      let skipReason: string | null = null;
      if (!member.whatsapp_reminders_enabled) skipReason = "Member has not opted in to automated WhatsApp reminders";
      else {
        try { recipient = whatsappNumber(member.phone, defaultCountryCode); }
        catch (error) { skipReason = error instanceof Error ? error.message : "Invalid WhatsApp number"; }
      }

      let deliveryId = prior?.id as string | undefined;
      if (!deliveryId) {
        const { data: created, error: createError } = await db.from("reminder_deliveries").insert({ gym_id: gym.id, membership_id: membership.id, rule_id: null, charge_id: balance.id, scheduled_for: today, status: "failed", channel: "whatsapp", recipient_snapshot: recipient ?? member.phone, subject_snapshot: gym.whatsapp_payment_template_name, message_snapshot: message, error: "Delivery started" }).select("id").single();
        if (createError) { if (createError.code === "23505") continue; totals.failed += 1; continue; }
        deliveryId = created.id;
      }
      if (skipReason || !recipient) {
        await db.from("reminder_deliveries").update({ status: "skipped", error: skipReason ?? "WhatsApp recipient is missing" }).eq("id", deliveryId);
        totals.skipped += 1;
        continue;
      }

      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "template", template: { name: gym.whatsapp_payment_template_name, language: { code: gym.whatsapp_template_language }, components: [{ type: "body", parameters: [member.name, gym.name, membership.plan_name, balanceText, dueDate].map((text) => ({ type: "text", text })) }] } }),
      });
      const payload = await response.json() as MetaResponse;
      const providerId = payload.messages?.[0]?.id;
      if (!response.ok || !providerId) {
        const error = payload.error?.error_user_msg ?? payload.error?.message ?? `Meta returned HTTP ${response.status}`;
        await db.from("reminder_deliveries").update({ status: "failed", error }).eq("id", deliveryId);
        totals.failed += 1;
      } else {
        await db.from("reminder_deliveries").update({ status: "sent", provider_id: providerId, error: null }).eq("id", deliveryId);
        totals.sent += 1;
      }
    }
  }
  return totals;
}

function first<T>(value: T | T[]): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function requiredEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is not configured`); return value; }
