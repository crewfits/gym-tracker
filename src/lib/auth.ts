import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";

export const requireGym = cache(async function requireGym() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: gym, error } = await supabase.from("gyms").select("*").eq("owner_id", user.id).maybeSingle();
  if (error) throw error;
  if (!gym) redirect("/access-not-configured");
  if (gym.is_active === false) redirect("/access-disabled");
  return { supabase, user, gym };
});
