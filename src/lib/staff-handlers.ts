import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffHandlerOption } from "@/lib/types";

export async function loadStaffHandlers(supabase: SupabaseClient, gymId: string, userId: string) {
  const [{ data: handlers, error }, { data: current, error: currentError }] = await Promise.all([
    supabase.from("gym_users").select("id,display_name,role").eq("gym_id", gymId).eq("status", "active").neq("role", "admin").order("role").order("display_name"),
    supabase.from("gym_users").select("id").eq("gym_id", gymId).eq("user_id", userId).eq("status", "active").maybeSingle(),
  ]);
  if (error) throw error;
  if (currentError) throw currentError;
  const options = ((handlers ?? []) as StaffHandlerOption[]).map((handler) => ({
    ...handler,
    display_name: handler.display_name || roleLabel(handler.role),
  }));
  const defaultHandlerId = options.some((handler) => handler.id === current?.id) ? current?.id ?? "" : options[0]?.id ?? "";
  return { handlers: options, defaultHandlerId };
}

export function roleLabel(role: string) {
  return role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
