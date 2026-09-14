"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { requestAppOrigin } from "@/lib/app-origin";
import { canAccess } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

const staffRole = z.enum(["receptionist", "trainer", "admin"]);
const staffStatus = z.enum(["active", "disabled"]);

function feedbackPath(type: "success" | "error", message: string) {
  return `/settings/staff?${type}=${encodeURIComponent(message)}`;
}

function isRedirect(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "Unable to update staff access";
  redirect(feedbackPath("error", message));
}

export async function createStaffUser(formData: FormData) {
  try {
    const input = z.object({
      email: z.email().transform((value) => value.trim().toLowerCase()),
      display_name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(30).optional(),
      role: staffRole,
    }).parse(Object.fromEntries(formData));
    const { gym, viewer } = await requirePermission("staff.manage");
    if (input.role === "admin" && !canAccess(viewer, "feature_flags.manage")) throw new Error("Admin access is restricted to internal FitKiro admins.");
    const admin = createAdminClient();
    const { data: flag, error: flagError } = await admin.from("gym_feature_flags").select("config_json").eq("gym_id", gym.id).eq("key", "staff_roles").maybeSingle();
    if (flagError) throw flagError;
    const config = (flag?.config_json ?? {}) as { trainerLimit?: number; receptionistLimit?: number };
    const limit = input.role === "trainer" ? Number(config.trainerLimit ?? 5) : input.role === "receptionist" ? Number(config.receptionistLimit ?? 1) : Infinity;
    if (Number.isFinite(limit)) {
      const { count, error: countError } = await admin.from("gym_users").select("id", { count: "exact", head: true }).eq("gym_id", gym.id).eq("role", input.role).eq("status", "active");
      if (countError) throw countError;
      if ((count ?? 0) >= limit) throw new Error(`This gym already has the allowed ${limit} active ${input.role}${limit === 1 ? "" : "s"}. Disable an existing user before adding another.`);
    }
    const { data: created, error: createError } = await admin.auth.admin.inviteUserByEmail(input.email, {
      data: { fitkiro_role: input.role, display_name: input.display_name },
      redirectTo: `${await requestAppOrigin()}/auth/complete`,
    });
    if (createError) throw createError;
    if (!created.user) throw new Error("Auth user was not created");
    const { error: accessError } = await admin.from("gym_users").insert({
      gym_id: gym.id,
      user_id: created.user.id,
      role: input.role,
      status: "active",
      display_name: input.display_name,
      phone: input.phone || null,
    });
    if (accessError) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw accessError;
    }
    revalidatePath("/settings/staff");
    redirect(feedbackPath("success", `Created ${input.display_name}. A password setup email was sent to ${input.email}.`));
  } catch (error) {
    if (isRedirect(error)) throw error;
    fail(error);
  }
}

export async function updateStaffUser(formData: FormData) {
  try {
    const input = z.object({
      id: z.uuid(),
      display_name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(30).optional(),
      role: staffRole,
      status: staffStatus,
    }).parse(Object.fromEntries(formData));
    const { supabase, gym, viewer } = await requirePermission("staff.manage");
    const canManageAdmins = canAccess(viewer, "feature_flags.manage");
    const { data: existing, error: existingError } = await supabase.from("gym_users").select("role").eq("id", input.id).eq("gym_id", gym.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new Error("Staff access row not found");
    if (existing.role === "owner") throw new Error("Owner access is protected");
    if (!canManageAdmins && (existing.role === "admin" || input.role === "admin")) throw new Error("Admin access is restricted to internal FitKiro admins.");
    const { error } = await supabase.from("gym_users").update({
      display_name: input.display_name,
      phone: input.phone || null,
      role: input.role,
      status: input.status,
      updated_at: new Date().toISOString(),
    }).eq("id", input.id).eq("gym_id", gym.id).neq("role", "owner");
    if (error) throw error;
    revalidatePath("/settings/staff");
    redirect(feedbackPath("success", "Staff access updated"));
  } catch (error) {
    if (isRedirect(error)) throw error;
    fail(error);
  }
}

export async function updateFeatureFlag(formData: FormData) {
  try {
    const input = z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]*$/),
      enabled: z.string().optional(),
      admin_enabled: z.string().optional(),
    }).parse(Object.fromEntries(formData));
    const { supabase, gym } = await requirePermission("feature_flags.manage");
    const { error } = await supabase.from("gym_feature_flags").update({
      enabled: input.enabled === "on",
      admin_enabled: input.admin_enabled === "on",
      updated_at: new Date().toISOString(),
    }).eq("gym_id", gym.id).eq("key", input.key);
    if (error) throw error;
    revalidatePath("/", "layout");
    redirect(feedbackPath("success", "Feature flag updated"));
  } catch (error) {
    if (isRedirect(error)) throw error;
    fail(error);
  }
}
