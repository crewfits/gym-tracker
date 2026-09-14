import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const confirmed = process.argv.includes("--confirm");

if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!confirmed) throw new Error("Refusing to clear member data without --confirm");

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: gyms, error: gymsError } = await admin.from("gyms").select("id,name").order("created_at");
if (gymsError) throw gymsError;
if (!gyms?.length) throw new Error("No gym was found");
if (gyms.length !== 1) throw new Error(`Refusing to clear ${gyms.length} gyms. Pass an explicit gym cleanup process instead.`);

const gym = gyms[0];
const deleted = {};

async function deleteGymRows(table) {
  const { count, error } = await admin.from(table).delete({ count: "exact" }).eq("gym_id", gym.id);
  if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  deleted[table] = count ?? 0;
}

async function removeGymPhotos() {
  const paths = [];
  async function collectFiles(prefix) {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await admin.storage.from("member-photos").list(prefix, { limit: 100, offset });
      if (error && !error.message.toLowerCase().includes("bucket not found")) throw error;
      if (!data?.length) break;
      for (const item of data) {
        const path = `${prefix}/${item.name}`;
        if (item.id) paths.push(path);
        else await collectFiles(path);
      }
      if (data.length < 100) break;
    }
  }
  await collectFiles(gym.id);
  if (paths.length) {
    const { error } = await admin.storage.from("member-photos").remove(paths);
    if (error) throw error;
  }
  deleted.member_photos = paths.length;
}

await removeGymPhotos();
for (const table of [
  "denied_access_attempts",
  "manual_reminder_events",
  "attendance_events",
  "member_qr_credentials",
  "payment_reversals",
  "payments",
  "charges",
  "memberships",
  "members",
  "payment_operations",
]) await deleteGymRows(table);

const { error: counterError } = await admin.from("gyms").update({ next_member_number: 1, next_receipt_number: 1 }).eq("id", gym.id);
if (counterError) throw counterError;

console.log(JSON.stringify({ ok: true, gym_id: gym.id, gym_name: gym.name, deleted, reset_counters: true }, null, 2));
