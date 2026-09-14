import { createClient } from "@supabase/supabase-js";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? "";
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  throw new Error("User lookup exceeded 10,000 authentication users");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = argument("email").trim().toLowerCase();
const confirmed = process.argv.includes("--confirm");

if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!email || !email.includes("@")) throw new Error("Pass a valid --email=user@example.com");
if (!confirmed) throw new Error("Refusing to delete an authentication user without --confirm");

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const user = await findUserByEmail(admin, email);

if (!user) {
  console.log(JSON.stringify({ ok: true, deleted: false, reason: "user_not_found", email }, null, 2));
  process.exit(0);
}

const { data: ownedGyms, error: ownedGymsError } = await admin
  .from("gyms")
  .select("id,name")
  .eq("owner_id", user.id);
if (ownedGymsError) throw ownedGymsError;
if (ownedGyms?.length) {
  throw new Error(`Refusing to delete ${email}: they own ${ownedGyms.map((gym) => `${gym.name} (${gym.id})`).join(", ")}. Transfer the gym owner first; deleting this Auth user would delete the gym and its client data.`);
}

const { data: staffRows, error: staffRowsError } = await admin
  .from("gym_users")
  .select("id,gym_id,role,gyms(name)")
  .eq("user_id", user.id);
if (staffRowsError) throw staffRowsError;

for (const staff of staffRows ?? []) {
  const filters = (query) => query.eq("gym_id", staff.gym_id).eq("assigned_trainer_user_id", staff.id);
  const { error: memberError } = await filters(admin.from("members").update({ assigned_trainer_user_id: null }));
  if (memberError) throw new Error(`Could not clear trainer assignments: ${memberError.message}`);

  const membershipQuery = admin.from("memberships").update({ handled_by_gym_user_id: null }).eq("gym_id", staff.gym_id).eq("handled_by_gym_user_id", staff.id);
  const { error: membershipError } = await membershipQuery;
  if (membershipError) throw new Error(`Could not clear membership handler references: ${membershipError.message}`);

  const paymentQuery = admin.from("payments").update({ handled_by_gym_user_id: null }).eq("gym_id", staff.gym_id).eq("handled_by_gym_user_id", staff.id);
  const { error: paymentError } = await paymentQuery;
  if (paymentError) throw new Error(`Could not clear payment handler references: ${paymentError.message}`);
}

const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
if (deleteError) throw deleteError;

console.log(JSON.stringify({
  ok: true,
  deleted: true,
  email,
  user_id: user.id,
  removed_staff_mappings: (staffRows ?? []).map((staff) => ({ gym_id: staff.gym_id, gym_name: staff.gyms?.name ?? null, role: staff.role })),
}, null, 2));
