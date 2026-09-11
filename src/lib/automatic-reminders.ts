import "server-only";

import { addDays, parseISO } from "date-fns";
import { businessDate, formatDate, formatDisplayDate } from "@/lib/domain";
import { renderReminderTemplate, whatsappNumber } from "@/lib/reminders";
import { createAdminClient } from "@/lib/supabase/admin";

type Gym = { id: string; name: string; timezone: string; renewal_reminder_template: string; whatsapp_payment_template_name: string; whatsapp_template_language: string };
type Member = { id: string; name: string; phone: string; is_archived: boolean; whatsapp_reminders_enabled: boolean };
type Membership = { id: string; member_id: string; plan_name: string; expires_on: string; members: Member | Member[] };
type ReminderRule = { id: string; days_before: number };
type MetaResponse = { messages?: Array<{ id: string }>; error?: { message?: string; error_user_msg?: string } };
type ReminderClaim = { delivery_id: string; claim_token: string };
export type ReminderRunResult = { sent: number; skipped: number; failed: number };

const AUTOMATIC_EXPIRY_RULE_DAYS = [7, 0] as const;

export async function processAutomaticPaymentReminders(gymId?: string): Promise<ReminderRunResult> {
  const accessToken = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = requiredEnv("WHATSAPP_GRAPH_API_VERSION");
  const defaultCountryCode = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "91";
  const db = createAdminClient();
  let gymQuery = db.from("gyms").select("id,name,timezone,renewal_reminder_template,whatsapp_payment_template_name,whatsapp_template_language");
  gymQuery = gymId ? gymQuery.eq("id", gymId) : gymQuery.eq("automatic_payment_whatsapp_enabled", true);
  const { data: gyms, error: gymsError } = await gymQuery;
  if (gymsError) throw gymsError;

  const totals = { sent: 0, skipped: 0, failed: 0 };
  for (const gym of (gyms ?? []) as Gym[]) {
    const today = businessDate(gym.timezone);
    const { data: rules, error: ruleError } = await db.from("reminder_rules").select("id,days_before").eq("gym_id", gym.id).eq("enabled", true).in("days_before", [...AUTOMATIC_EXPIRY_RULE_DAYS]);
    if (ruleError) { totals.failed += 1; continue; }
    if (!rules?.length) continue;

    for (const reminderRule of rules as ReminderRule[]) {
      const expiryDate = formatDate(addDays(parseISO(today), reminderRule.days_before));
      const { data: memberships, error: membershipsError } = await db.from("memberships").select("id,member_id,plan_name,expires_on,members!inner(id,name,phone,is_archived,whatsapp_reminders_enabled)").eq("gym_id", gym.id).is("reverted_at", null).lte("starts_on", today).eq("expires_on", expiryDate);
      if (membershipsError) { totals.failed += 1; continue; }
      const expiringMemberships = (memberships ?? []) as Membership[];
      if (!expiringMemberships.length) continue;

      const memberIds = expiringMemberships.map((membership) => membership.member_id);
      const { data: futureMemberships, error: futureMembershipsError } = await db.from("memberships").select("member_id").eq("gym_id", gym.id).is("reverted_at", null).gt("starts_on", today).in("member_id", memberIds);
      if (futureMembershipsError) { totals.failed += expiringMemberships.length; continue; }
      const renewedMemberIds = new Set((futureMemberships ?? []).map((membership) => membership.member_id as string));

      for (const membership of expiringMemberships) {
        const member = first(membership.members);
        if (!member || member.is_archived || renewedMemberIds.has(member.id)) continue;

        const displayExpiryDate = formatDisplayDate(membership.expires_on);
        const values = { name: member.name, gym_name: gym.name, plan_name: membership.plan_name, expiry_date: displayExpiryDate };
        const message = renderReminderTemplate(gym.renewal_reminder_template, values);
        let recipient: string | null = null;
        let skipReason: string | null = null;
        if (!member.whatsapp_reminders_enabled) skipReason = "Member has not opted in to automated WhatsApp reminders";
        else {
          try { recipient = whatsappNumber(member.phone, defaultCountryCode); }
          catch (error) { skipReason = error instanceof Error ? error.message : "Invalid WhatsApp number"; }
        }

        const { data: claim, error: claimError } = await db.rpc("claim_whatsapp_payment_reminder", {
          p_gym_id: gym.id,
          p_membership_id: membership.id,
          p_rule_id: reminderRule.id,
          p_scheduled_for: today,
          p_recipient_snapshot: recipient ?? member.phone,
          p_subject_snapshot: gym.whatsapp_payment_template_name,
          p_message_snapshot: message,
        }).maybeSingle() as { data: ReminderClaim | null; error: { message: string } | null };

        if (claimError) { totals.failed += 1; continue; }
        if (!claim) continue;

        const deliveryId = claim.delivery_id;
        const claimToken = claim.claim_token;
        if (skipReason || !recipient) {
          await finalizeDelivery(deliveryId, claimToken, { status: "skipped", error: skipReason ?? "WhatsApp recipient is missing" }, db);
          totals.skipped += 1;
          continue;
        }

        let response: Response;
        try {
          response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "template", template: { name: gym.whatsapp_payment_template_name, language: { code: gym.whatsapp_template_language }, components: [{ type: "body", parameters: [member.name, gym.name, membership.plan_name, displayExpiryDate].map((text) => ({ type: "text", text })) }] } }),
            signal: AbortSignal.timeout(15000),
          });
        } catch (error) {
          await finalizeDelivery(deliveryId, claimToken, { status: "failed", error: error instanceof Error ? error.message : "Meta request failed" }, db);
          totals.failed += 1;
          continue;
        }
        const payload = await readMetaResponse(response);
        const providerId = payload.messages?.[0]?.id;
        if (!response.ok || !providerId) {
          const error = payload.error?.error_user_msg ?? payload.error?.message ?? `Meta returned HTTP ${response.status}`;
          await finalizeDelivery(deliveryId, claimToken, { status: "failed", error }, db);
          totals.failed += 1;
        } else {
          await finalizeDelivery(deliveryId, claimToken, { status: "sent", provider_id: providerId, error: null }, db);
          totals.sent += 1;
        }
      }
    }
  }
  return totals;
}

// Both owner-triggered actions share the scheduler's delivery claims and audit trail.
export async function processAutomaticMembershipReminders(gymId?: string): Promise<ReminderRunResult> {
  return processAutomaticPaymentReminders(gymId);
}

function first<T>(value: T | T[]): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function requiredEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is not configured`); return value; }

async function readMetaResponse(response: Response): Promise<MetaResponse> {
  try {
    return await response.json() as MetaResponse;
  } catch {
    return { error: { message: `Meta returned HTTP ${response.status}` } };
  }
}

async function finalizeDelivery(deliveryId: string, claimToken: string, patch: { status: "sent" | "skipped" | "failed"; provider_id?: string; error: string | null }, db = createAdminClient()) {
  const { error } = await db.from("reminder_deliveries").update({
    ...patch,
    claimed_at: null,
    claim_token: null,
  }).eq("id", deliveryId).eq("claim_token", claimToken);
  if (error) throw error;
}
