import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";

export const requireGym = cache(async function requireGym() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  let { data: gym } = await supabase.from("gyms").select("*").eq("owner_id", user.id).maybeSingle();
  if (!gym) { await supabase.rpc("bootstrap_gym", { gym_name: user.user_metadata.gym_name ?? "My Gym" }); const result = await supabase.from("gyms").select("*").eq("owner_id", user.id).single(); gym = result.data; }
  if (!gym) throw new Error("Unable to load gym profile");
  return { supabase, user, gym };
});
