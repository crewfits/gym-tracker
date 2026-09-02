"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireGym } from "@/lib/auth";
import { attendanceLabel } from "@/lib/domain";
import { isShortQrCode, verifyQrToken, type QrTokenPayload } from "@/lib/qr-token";

function isRedirect(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function go(path: string, type: "success" | "error", message: string): never {
  redirect(`${path}?${type}=${encodeURIComponent(message)}`);
}

export async function issueMemberQr(formData: FormData) {
  const memberId = z.uuid().parse(formData.get("member_id"));
  try {
    const { supabase, gym } = await requireGym();
    const { data: member } = await supabase.from("members").select("id").eq("id", memberId).eq("gym_id", gym.id).eq("is_archived", false).maybeSingle();
    if (!member) throw new Error("Active member not found");
    const { error } = await supabase.rpc("issue_member_qr", { p_member_id: memberId });
    if (error) throw error;
    revalidatePath(`/members/${memberId}`);
    go(`/members/${memberId}/qr`, "success", "QR generated. Previous copies, if any, are now invalid.");
  } catch (error) {
    if (isRedirect(error)) throw error;
    go(`/members/${memberId}/qr`, "error", messageFrom(error));
  }
}

export async function disableMemberQr(formData: FormData) {
  const memberId = z.uuid().parse(formData.get("member_id"));
  try {
    const { supabase } = await requireGym();
    const { error } = await supabase.rpc("disable_member_qr", { p_member_id: memberId });
    if (error) throw error;
    revalidatePath(`/members/${memberId}`);
    go(`/members/${memberId}/qr`, "success", "QR disabled.");
  } catch (error) {
    if (isRedirect(error)) throw error;
    go(`/members/${memberId}/qr`, "error", messageFrom(error));
  }
}

export async function markMemberQrShared(formData: FormData) {
  const memberId = z.uuid().parse(formData.get("member_id"));
  try {
    const { supabase, gym, user } = await requireGym();
    const { data: credential, error: credentialError } = await supabase.from("member_qr_credentials").select("member_id,enabled").eq("member_id", memberId).eq("gym_id", gym.id).maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential?.enabled) throw new Error("Generate an active QR before marking it shared");
    const { error } = await supabase.from("member_qr_credentials").update({ shared_at: new Date().toISOString(), shared_by: user.id, share_method: "manual_whatsapp", updated_at: new Date().toISOString() }).eq("member_id", memberId).eq("gym_id", gym.id).eq("enabled", true);
    if (error) throw error;
    revalidatePath("/members");
    revalidatePath(`/members/${memberId}`);
    revalidatePath(`/members/${memberId}/qr`);
    go(`/members/${memberId}/qr`, "success", "QR marked as shared.");
  } catch (error) {
    if (isRedirect(error)) throw error;
    go(`/members/${memberId}/qr`, "error", messageFrom(error));
  }
}

export async function recordAttendance(formData: FormData) {
  const input = z.object({
    token: z.string().min(12).max(1000),
    direction: z.enum(["entry", "exit"]),
    request_id: z.uuid(),
  }).parse(Object.fromEntries(formData));
  const scanPath = `/s/${input.token}`;

  try {
    const { supabase, gym } = await requireGym();
    let payload: QrTokenPayload | null = null;

    if (isShortQrCode(input.token)) {
      const { data: credential } = await supabase.from("member_qr_credentials").select("member_id,version").eq("public_code", input.token).eq("gym_id", gym.id).maybeSingle();
      if (credential) payload = { gymId: gym.id, memberId: credential.member_id, version: credential.version };
    } else {
      payload = verifyQrToken(input.token);
    }

    if (!payload) throw new Error("This QR is invalid");
    if (payload.gymId !== gym.id) throw new Error("This QR belongs to another gym");
    const { error } = await supabase.rpc("record_attendance", {
      p_member_id: payload.memberId,
      p_qr_version: payload.version,
      p_direction: input.direction,
      p_request_id: input.request_id,
    });
    if (error) throw error;
    revalidatePath(scanPath);
    go(scanPath, "success", `${attendanceLabel(input.direction)} recorded`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    go(scanPath, "error", messageFrom(error));
  }
}
