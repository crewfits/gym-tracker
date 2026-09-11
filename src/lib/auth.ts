import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { canAccess, type GymRole, type Permission, type Viewer } from "@/lib/permissions";

type FlagRow = { key: string; enabled: boolean; admin_enabled: boolean };

export const requireGym = cache(async function requireGym() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  const ownerId = authData?.claims.sub;
  if (authError || !ownerId) redirect("/login");
  const user = { id: ownerId };
  const [{ data: gymId, error: gymIdError }, { data: roleData, error: roleError }] = await Promise.all([
    supabase.rpc("current_gym_id"),
    supabase.rpc("current_gym_role"),
  ]);
  if (gymIdError) throw gymIdError;
  if (roleError) throw roleError;
  const { data: gym, error } = gymId
    ? await supabase.from("gyms").select("*").eq("id", gymId).maybeSingle()
    : await supabase.from("gyms").select("*").eq("owner_id", user.id).maybeSingle();
  if (error) throw error;
  if (!gym) redirect("/access-not-configured");
  if (gym.is_active === false) redirect("/access-disabled");
  const { data: flags, error: flagsError } = await supabase
    .from("gym_feature_flags")
    .select("key,enabled,admin_enabled")
    .eq("gym_id", gym.id);
  if (flagsError && flagsError.code !== "42P01") throw flagsError;
  const role = (roleData ?? "owner") as GymRole;
  const viewer: Viewer = {
    role,
    features: Object.fromEntries(((flags ?? []) as FlagRow[]).map((flag) => [flag.key, flag.enabled])),
    adminFeatures: Object.fromEntries(((flags ?? []) as FlagRow[]).map((flag) => [flag.key, flag.admin_enabled])),
  };
  return { supabase, user, gym, role, viewer };
});

export async function requirePermission(permission: Permission, featureKey?: string) {
  const context = await requireGym();
  if (!canAccess(context.viewer, permission, featureKey)) redirect("/forbidden");
  return context;
}
