import { createClient } from "@supabase/supabase-js";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? "";
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  return null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = argument("email").trim().toLowerCase();
const activeValue = argument("active");

if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!email || !email.includes("@")) throw new Error("Pass a valid --email=owner@example.com");
if (!['true', 'false'].includes(activeValue)) throw new Error("Pass --active=true or --active=false");

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const user = await findUserByEmail(admin, email);
if (!user) throw new Error("Authentication user not found");

const isActive = activeValue === "true";
const { data: gym, error } = await admin.from("gyms").update({ is_active: isActive }).eq("owner_id", user.id).select("id,name").maybeSingle();
if (error) throw error;
if (!gym) throw new Error("Gym assignment not found");
console.log(`${gym.name} owner access is now ${isActive ? "active" : "disabled"}`);
