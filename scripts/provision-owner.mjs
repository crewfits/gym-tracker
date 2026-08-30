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
const email = argument("email").trim().toLowerCase();
const gymName = argument("gym-name").trim();
const timezone = argument("timezone", "Asia/Kolkata").trim();
const password = process.env.FITKIRO_OWNER_PASSWORD;

if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!email || !email.includes("@")) throw new Error("Pass a valid --email=owner@example.com");
if (!gymName) throw new Error("Pass --gym-name=\"Example Gym\"");

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
let user = await findUserByEmail(admin, email);
let createdUser = false;

if (!user) {
  if (!password || password.length < 12) throw new Error("Set FITKIRO_OWNER_PASSWORD to a temporary password of at least 12 characters");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "gym_owner" },
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

console.log(`Provisioned ${gym.name} (${gym.id}) for ${email}`);
console.log(createdUser ? "The temporary password was accepted; share it securely and rotate it after handoff." : "The existing authentication user was assigned to the gym.");
