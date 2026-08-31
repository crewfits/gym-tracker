import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";

export const requireGym = cache(async function requireGym() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  const ownerId = authData?.claims.sub;
  if (authError || !ownerId) redirect("/login");
  const user = { id: ownerId };
  const { data: gym, error } = await supabase.from("gyms").select("*").eq("owner_id", user.id).maybeSingle();
  if (error) throw error;
  if (!gym) redirect("/access-not-configured");
  if (gym.is_active === false) redirect("/access-disabled");
  return { supabase, user, gym };
});
