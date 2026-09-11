"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { attendanceLabel, formatDisplayDateTime } from "@/lib/domain";
import { signedMemberPhotoUrl } from "@/lib/member-photo";
import { safeReturnPath } from "@/lib/return-path";
import type { AttendanceDirection } from "@/lib/types";
import { attendanceQrToken, isShortQrCode, verifyQrToken, type QrTokenPayload } from "@/lib/qr-token";

function isRedirect(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return typeof error === "string" ? error : "Unable to complete the attendance request";
}

function scannerDenialMessage(error: unknown): string {
  const message = messageFrom(error);
  if (/active membership/i.test(message)) return "Membership expired or inactive";
  if (/disabled or replaced/i.test(message)) return "QR disabled or replaced";
  if (/active member not found/i.test(message)) return "Member is archived or inactive";
  return message;
}

function go(path: string, type: "success" | "error", message: string): never {
  redirect(`${path}?${type}=${encodeURIComponent(message)}`);
}

function goWithFeedback(path: string, type: "success" | "error", message: string): never {
  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(type, message);
  params.delete(type === "success" ? "error" : "success");
  redirect(`${pathname}?${params.toString()}`);
}

export async function issueMemberQr(formData: FormData) {
  const memberId = z.uuid().parse(formData.get("member_id"));
  try {
    const { supabase, gym } = await requirePermission("members.manage");
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
    const { supabase } = await requirePermission("members.manage");
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
    const { supabase, gym, user } = await requirePermission("members.manage");
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
    denied_only: z.string().optional(),
  }).parse(Object.fromEntries(formData));
  const scanPath = `/s/${input.token}`;

  try {
    const { supabase, gym } = await requirePermission(input.denied_only === "true" ? "attendance.view" : "attendance.scan");
    let payload: QrTokenPayload | null = null;

    if (isShortQrCode(input.token)) {
      const { data: credential } = await supabase.from("member_qr_credentials").select("member_id,version").eq("public_code", input.token).eq("gym_id", gym.id).maybeSingle();
      if (credential) payload = { gymId: gym.id, memberId: credential.member_id, version: credential.version };
    } else {
      payload = verifyQrToken(input.token);
    }

    if (!payload) throw new Error("This QR is invalid");
    if (payload.gymId !== gym.id) throw new Error("This QR belongs to another gym");
    const { data: result, error } = await supabase.rpc("process_qr_access", {
      p_member_id: payload.memberId,
      p_qr_version: payload.version,
      p_direction: input.direction,
      p_request_id: input.request_id,
      p_denied_only: input.denied_only === "true",
    });
    if (error) throw error;
    revalidatePath(scanPath);
    revalidatePath("/attendance");
    if (result?.status === "denied") go(scanPath, "error", "Membership expired — access denied. Attempt logged.");
    if (result?.status === "allowed") go(scanPath, "success", "Membership is now active. Review access before recording attendance.");
    if (result?.status !== "recorded" || !result.event) throw new Error("Unable to confirm attendance. Please retry.");
    go(scanPath, "success", `${attendanceLabel(input.direction)} recorded`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    go(scanPath, "error", messageFrom(error));
  }
}

export type ScannerAttendanceResult = {
  status: "recorded" | "denied";
  message: string;
  token?: string;
  direction?: AttendanceDirection;
  memberName?: string;
  memberCode?: string;
  photoUrl?: string | null;
  occurredAt?: string;
};

async function recordScannerMovement(rawValue: string, requestId: string, forcedDirection?: AttendanceDirection): Promise<ScannerAttendanceResult> {
  const parsedValue = z.string().max(2000).safeParse(rawValue);
  const parsedId = z.uuid().safeParse(requestId);
  if (!parsedValue.success || !parsedId.success) return { status: "denied", message: "This is not a valid FitKiro attendance QR" };
  const token = attendanceQrToken(parsedValue.data);
  const parsedRequestId = parsedId.data;
  if (!token) return { status: "denied", message: "This is not a valid FitKiro attendance QR" };

  try {
    const { supabase, gym } = await requirePermission("attendance.scan");
    let payload: QrTokenPayload | null = null;
    if (isShortQrCode(token)) {
      const { data } = await supabase.from("member_qr_credentials").select("member_id,version").eq("public_code", token).eq("gym_id", gym.id).maybeSingle();
      if (data) payload = { gymId: gym.id, memberId: data.member_id, version: data.version };
    } else payload = verifyQrToken(token);
    if (!payload || payload.gymId !== gym.id) return { status: "denied", message: "This QR is invalid or belongs to another gym" };

    const { data: member } = await supabase.from("members").select("name,member_code,profile_photo_path").eq("id", payload.memberId).eq("gym_id", gym.id).maybeSingle();
    if (!member) return { status: "denied", message: "Member not found" };

    const { data: result, error } = await supabase.rpc("process_qr_access", {
      p_member_id: payload.memberId, p_qr_version: payload.version, p_request_id: parsedRequestId,
      p_direction: forcedDirection ?? null,
    });
    if (error) return {
      status: "denied",
      message: scannerDenialMessage(error),
      memberName: member.name,
      memberCode: member.member_code,
      photoUrl: await signedMemberPhotoUrl(supabase, member.profile_photo_path),
    };
    if (result?.status === "denied" && result.attempt) {
      revalidatePath("/attendance");
      return {
        status: "denied", message: `Membership expired — access denied. Attempt ${result.duplicate ? "already logged" : "logged"}.`,
        memberName: member.name, memberCode: member.member_code,
        photoUrl: await signedMemberPhotoUrl(supabase, member.profile_photo_path),
        occurredAt: formatDisplayDateTime(result.attempt.occurred_at, gym.timezone),
      };
    }
    if (result?.status !== "recorded" || !result.event) return { status: "denied", message: "Unable to confirm attendance. Please retry." };
    const event = result.event;
    const direction = event?.direction ?? forcedDirection ?? "entry";
    const occurredAt = event?.occurred_at ?? new Date().toISOString();
    const duplicateSuppressed = event?.request_id !== parsedRequestId;
    revalidatePath("/attendance");
    return {
      status: "recorded",
      message: `${attendanceLabel(direction)} ${duplicateSuppressed ? "already recorded" : "recorded"}`,
      token,
      direction,
      memberName: member.name,
      memberCode: member.member_code,
      photoUrl: await signedMemberPhotoUrl(supabase, member.profile_photo_path),
      occurredAt: formatDisplayDateTime(occurredAt, gym.timezone),
    };
  } catch (error) {
    return { status: "denied", message: scannerDenialMessage(error) };
  }
}

export async function scanAndRecordAttendance(rawValue: string, requestId: string) {
  return recordScannerMovement(rawValue, requestId);
}

export async function correctScannerAttendance(token: string, originalDirection: AttendanceDirection, requestId: string) {
  const direction = z.enum(["entry", "exit"]).parse(originalDirection) === "entry" ? "exit" : "entry";
  return recordScannerMovement(token, requestId, direction);
}

export async function correctAttendanceLog(formData: FormData) {
  const requestedReturnPath = safeReturnPath(formData.get("return_path"));
  const returnPath = requestedReturnPath === "/attendance" || requestedReturnPath.startsWith("/attendance?") ? requestedReturnPath : "/attendance";

  try {
    const input = z.object({
      event_id: z.uuid(),
      request_id: z.uuid(),
      reason: z.string().trim().min(3).max(240),
      replacement_direction: z.union([z.enum(["entry", "exit"]), z.literal("")]),
    }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("attendance.view");
    const { data: event, error: eventError } = await supabase.from("attendance_events").select("member_id,direction").eq("id", input.event_id).eq("gym_id", gym.id).maybeSingle();
    if (eventError) throw eventError;
    if (!event) throw new Error("Attendance event not found");

    const { error } = await supabase.rpc("correct_latest_attendance_event", {
      p_event_id: input.event_id,
      p_replacement_direction: input.replacement_direction || null,
      p_request_id: input.request_id,
      p_reason: input.reason,
    });
    if (error) throw error;

    revalidatePath("/");
    revalidatePath("/attendance");
    revalidatePath(`/members/${event.member_id}/qr`);
    const original = attendanceLabel(event.direction as AttendanceDirection);
    const message = input.replacement_direction
      ? `${original} undone and a new ${attendanceLabel(input.replacement_direction)} recorded.`
      : `${original} undone. The next scan will use the corrected attendance history.`;
    goWithFeedback(returnPath, "success", message);
  } catch (error) {
    if (isRedirect(error)) throw error;
    goWithFeedback(returnPath, "error", messageFrom(error));
  }
}
