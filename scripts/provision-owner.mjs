import { createClient } from "@supabase/supabase-js";

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  throw new Error("Owner lookup exceeded 1,000 authentication users");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const email = argument("email").trim().toLowerCase();
const gymName = argument("gym-name").trim();
const timezone = argument("timezone", "Asia/Kolkata").trim();

if (!url || !serviceRoleKey || !appUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_APP_URL are required");
if (!email || !email.includes("@")) throw new Error("Pass a valid --email=owner@example.com");
if (!gymName) throw new Error("Pass --gym-name=\"Example Gym\"");

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
let user = await findUserByEmail(admin, email);
let createdUser = false;

if (!user) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role: "gym_owner" },
    redirectTo: new URL("/auth/complete", appUrl).toString(),
  });
  if (error) throw error;
  user = data.user;
  createdUser = true;
}

const { data: existingGym, error: existingError } = await admin.from("gyms").select("id,name,is_active").eq("owner_id", user.id).maybeSingle();
if (existingError) throw existingError;
if (existingGym) {
  console.log(`Owner is already provisioned for ${existingGym.name} (${existingGym.id}); active=${existingGym.is_active}`);
  process.exit(0);
}

const { data: gym, error: gymError } = await admin.from("gyms").insert({ owner_id: user.id, name: gymName, timezone, is_active: true }).select("id,name").single();
if (gymError) {
  if (createdUser) await admin.auth.admin.deleteUser(user.id);
  throw gymError;
}

const { error: ownerAccessError } = await admin.from("gym_users").insert({ gym_id: gym.id, user_id: user.id, role: "owner", status: "active", display_name: "Owner" });
if (ownerAccessError) {
  await admin.from("gyms").delete().eq("id", gym.id);
  if (createdUser) await admin.auth.admin.deleteUser(user.id);
  throw ownerAccessError;
}

const { error: flagError } = await admin.from("gym_feature_flags").insert([
  { gym_id: gym.id, key: "staff_roles", enabled: true, admin_enabled: true, config_json: { trainerLimit: 5, receptionistLimit: 1 } },
  { gym_id: gym.id, key: "trainer_assignment", enabled: true, admin_enabled: true, config_json: {} },
  { gym_id: gym.id, key: "csv_exports", enabled: true, admin_enabled: true, config_json: {} },
]);
if (flagError) {
  await admin.from("gyms").delete().eq("id", gym.id);
  if (createdUser) await admin.auth.admin.deleteUser(user.id);
  throw flagError;
}

console.log(`Provisioned ${gym.name} (${gym.id}) for ${email}`);
console.log(createdUser ? "An invitation email was sent. The owner must choose a password through that link before signing in." : "The existing authentication user was assigned to the gym. Use Forgot password if they need a new password.");
