import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
function requireEnv(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function addDays(date, days) { const next = new Date(`${date}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); }
function paise(amount) { return Math.round(amount * 100); }
function chunk(items, size = 500) { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function fullName(index) {
  const first = ["Aarav", "Diya", "Kavin", "Meera", "Vikram", "Anika", "Rohan", "Isha", "Arjun", "Nila", "Sanjay", "Tara"];
  const last = ["Kumar", "Rao", "Menon", "Shah", "Iyer", "Nair", "Patel", "Das", "Reddy", "Bose", "Kapoor", "Pillai"];
  return `${first[index % first.length]} ${last[Math.floor(index / first.length) % last.length]} ${String(index + 1).padStart(4, "0")}`;
}
function roleEmail(runId, role, index = 0) { return `fitkiro.loadtest+${runId}.${role}${index ? index : ""}@example.com`; }
function qrPublicCode(index) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = index + 1;
  let code = "";
  for (let offset = 0; offset < 12; offset++) {
    code += alphabet[(value + offset * 7) % alphabet.length];
    value = Math.floor(value / alphabet.length);
  }
  return code;
}
function manifestPath(runId) { return path.join(process.cwd(), "tmp", `load-test-${runId}.json`); }
function usage() {
  console.log(`Usage:\n  npm run testdata:load:seed -- --confirm [--members=1500] [--active=600] [--run-id=handshake]\n  npm run testdata:load:cleanup -- --confirm --manifest=tmp/load-test-<run-id>.json\n  npm run testdata:load:cleanup -- --confirm --gym-id=<uuid>\n\nSeed requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
}

const command = process.argv[2];
if (!command || ["seed", "cleanup", "help"].includes(command) === false) { usage(); process.exit(command ? 1 : 0); }
if (command === "help") { usage(); process.exit(0); }
if (!hasFlag("confirm")) throw new Error("Pass --confirm so this cannot run accidentally.");

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function insertMany(table, rows, size = 500) {
  for (const part of chunk(rows, size)) {
    if (!part.length) continue;
    const { error } = await admin.from(table).insert(part);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}
function isMissingOptionalTable(error) {
  return error?.code === "42P01" || error?.code === "42703" || error?.code === "PGRST205" || /Could not find the table/i.test(error?.message ?? "") || /schema cache/i.test(error?.message ?? "");
}
async function upsertMany(table, rows, onConflict, size = 500) {
  for (const part of chunk(rows, size)) {
    if (!part.length) continue;
    const { error } = await admin.from(table).upsert(part, { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}
async function createAuthUser(email, password, role, runId) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { fitkiro_load_test: true, fitkiro_load_test_run: runId, fitkiro_role: role },
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  return data.user;
}
async function listLoadTestUsers(runId) {
  const users = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    users.push(...data.users.filter((user) => user.user_metadata?.fitkiro_load_test_run === runId));
    if (data.users.length < 100) break;
  }
  return users;
}

async function seed() {
  const runId = (arg("run-id") || new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)).toLowerCase();
  const membersTarget = Number(arg("members", "1500"));
  const activeTarget = Number(arg("active", "600"));
  if (!Number.isInteger(membersTarget) || membersTarget < 100) throw new Error("--members must be at least 100");
  if (!Number.isInteger(activeTarget) || activeTarget < 1 || activeTarget > membersTarget) throw new Error("--active must be between 1 and members");
  const today = arg("today", new Date().toISOString().slice(0, 10));
  const password = arg("password", "FitKiroLoadTest#2026");
  if (password.length < 12) throw new Error("--password must be at least 12 characters");

  const staffSpecs = [
    { role: "admin", email: roleEmail(runId, "admin"), display_name: "Load Test Admin" },
    { role: "owner", email: roleEmail(runId, "owner"), display_name: "Load Test Owner" },
    ...Array.from({ length: 5 }, (_, index) => ({ role: "trainer", email: roleEmail(runId, "trainer", index + 1), display_name: `Load Test Trainer ${index + 1}` })),
    { role: "receptionist", email: roleEmail(runId, "receptionist"), display_name: "Load Test Receptionist" },
  ];
  const createdUsers = [];
  let gymId = null;
  try {
    for (const spec of staffSpecs) createdUsers.push({ ...spec, user: await createAuthUser(spec.email, password, spec.role, runId) });
    const owner = createdUsers.find((item) => item.role === "owner");
    const gymName = `FitKiro Load Test ${runId}`;
    const { data: gym, error: gymError } = await admin.from("gyms").insert({
      owner_id: owner.user.id,
      name: gymName,
      timezone: "Asia/Kolkata",
      receipt_prefix: `LT${runId.slice(-4).toUpperCase()}`,
      is_active: true,
      email: "loadtest@example.com",
      phone: "+910000000000",
      address: "Synthetic data gym - safe to delete",
    }).select("id,name").single();
    if (gymError) throw gymError;
    gymId = gym.id;

    await insertMany("gym_users", createdUsers.map((item) => ({
      gym_id: gymId,
      user_id: item.user.id,
      role: item.role,
      status: "active",
      display_name: item.display_name,
      phone: item.role === "owner" ? "+919000000000" : `+91900000${String(createdUsers.indexOf(item) + 1).padStart(4, "0")}`,
    })));
    await upsertMany("gym_feature_flags", [
      { gym_id: gymId, key: "staff_roles", enabled: true, admin_enabled: true, config_json: { trainerLimit: 5, receptionistLimit: 1 } },
      { gym_id: gymId, key: "trainer_assignment", enabled: true, admin_enabled: true, config_json: {} },
      { gym_id: gymId, key: "csv_exports", enabled: true, admin_enabled: true, config_json: {} },
    ], "gym_id,key");

    const plans = [
      { id: randomUUID(), gym_id: gymId, name: "Monthly Basic", duration_value: 1, duration_unit: "months", default_fee_paise: paise(1500), is_active: true },
      { id: randomUUID(), gym_id: gymId, name: "Quarterly Plus", duration_value: 3, duration_unit: "months", default_fee_paise: paise(4200), is_active: true },
      { id: randomUUID(), gym_id: gymId, name: "Half Year Strength", duration_value: 6, duration_unit: "months", default_fee_paise: paise(7800), is_active: true },
      { id: randomUUID(), gym_id: gymId, name: "Annual Elite", duration_value: 12, duration_unit: "months", default_fee_paise: paise(14000), is_active: true },
    ];
    await insertMany("plans", plans);
    await insertMany("reminder_rules", [7, 3, 1].map((days_before) => ({ gym_id: gymId, days_before, enabled: true })));

    const { data: gymUsers, error: gymUsersError } = await admin.from("gym_users").select("id,user_id,role,display_name").eq("gym_id", gymId);
    if (gymUsersError) throw gymUsersError;
    const trainerAccessRows = gymUsers.filter((row) => row.role === "trainer");
    const handlerRows = gymUsers.filter((row) => row.role !== "admin");

    const members = [];
    const memberships = [];
    const charges = [];
    const payments = [];
    const qrRows = [];
    const attendanceRows = [];
    const deniedRows = [];
    const reminderRows = [];
    let receipt = 1;

    const expiredCount = Math.floor((membersTarget - activeTarget) * 0.55);
    const upcomingCount = Math.floor((membersTarget - activeTarget) * 0.15);
    const archivedStart = activeTarget + expiredCount + upcomingCount;
    const expiringWithinActive = Math.min(120, Math.floor(activeTarget * 0.2));

    for (let index = 0; index < membersTarget; index++) {
      const memberId = randomUUID();
      const plan = plans[index % plans.length];
      const trainer = trainerAccessRows[index % trainerAccessRows.length];
      const handler = handlerRows[index % handlerRows.length];
      const isArchived = index >= archivedStart;
      const memberCode = `LT-${String(index + 1).padStart(5, "0")}`;
      const phone = `9888${String(index + 1).padStart(6, "0")}`;
      members.push({
        id: memberId,
        gym_id: gymId,
        member_code: memberCode,
        name: fullName(index),
        phone,
        email: index % 4 === 0 ? `load.member.${runId}.${index + 1}@example.com` : null,
        notes: index % 10 === 0 ? "Synthetic load-test member with longer notes for layout testing." : null,
        is_archived: isArchived,
        assigned_trainer_user_id: trainer?.id ?? null,
        whatsapp_reminders_enabled: index % 3 !== 0,
        created_at: `${addDays(today, -Math.min(730, index))}T09:00:00.000Z`,
        updated_at: `${addDays(today, -Math.min(30, index % 30))}T09:00:00.000Z`,
      });

      let startsOn;
      let expiresOn;
      if (index < activeTarget) {
        startsOn = addDays(today, -((index % 120) + 1));
        expiresOn = index < expiringWithinActive ? addDays(today, index % 8) : addDays(today, 20 + (index % 220));
      } else if (index < activeTarget + expiredCount) {
        startsOn = addDays(today, -420 - (index % 180));
        expiresOn = addDays(today, -1 - (index % 240));
      } else if (index < activeTarget + expiredCount + upcomingCount) {
        startsOn = addDays(today, 1 + (index % 45));
        expiresOn = addDays(startsOn, 30 + (index % 90));
      } else {
        startsOn = addDays(today, -700 + (index % 90));
        expiresOn = addDays(today, -360 + (index % 120));
      }

      const membershipId = randomUUID();
      const chargeId = randomUUID();
      const discount = index % 11 === 0 ? paise(250) : index % 17 === 0 ? paise(500) : 0;
      const gstBps = index % 8 === 0 ? 1800 : 0;
      const subtotal = plan.default_fee_paise + paise((index % 5) * 100);
      const tax = Math.round(((subtotal - discount) * gstBps) / 10000);
      const total = subtotal - discount + tax;
      const unpaidPattern = index % 7;
      const paid = unpaidPattern === 0 ? 0 : unpaidPattern === 1 ? Math.floor(total * 0.35) : unpaidPattern === 2 ? Math.floor(total * 0.7) : total;
      memberships.push({
        id: membershipId,
        gym_id: gymId,
        member_id: memberId,
        plan_id: plan.id,
        plan_name: plan.name,
        duration_value: plan.duration_value,
        duration_unit: plan.duration_unit,
        starts_on: startsOn,
        expires_on: expiresOn,
        date_overridden: index % 13 === 0,
        handled_by_gym_user_id: handler?.id ?? null,
        created_at: `${startsOn}T09:00:00.000Z`,
      });
      charges.push({
        id: chargeId,
        gym_id: gymId,
        membership_id: membershipId,
        subtotal_paise: subtotal,
        discount_paise: discount,
        gst_rate_basis_points: gstBps,
        tax_paise: tax,
        total_paise: total,
        due_on: addDays(startsOn, 7),
        created_at: `${startsOn}T09:05:00.000Z`,
      });
      if (paid > 0) {
        const split = index % 9 === 0 && paid > 100000;
        const firstAmount = split ? Math.floor(paid * 0.6) : paid;
        const secondAmount = paid - firstAmount;
        for (const [offset, amount] of [firstAmount, secondAmount].entries()) {
          if (amount <= 0) continue;
          payments.push({
            id: randomUUID(),
            gym_id: gymId,
            charge_id: chargeId,
            amount_paise: amount,
            method: ["cash", "upi", "card", "bank_transfer"][(index + offset) % 4],
            reference: (index + offset) % 3 === 0 ? `LT-${runId}-${index + 1}-${offset + 1}` : null,
            paid_on: addDays(startsOn, offset),
            notes: split ? "Synthetic split payment" : null,
            receipt_number: `LT${runId.slice(-4).toUpperCase()}-${String(receipt++).padStart(6, "0")}`,
            handled_by_gym_user_id: handler?.id ?? null,
            created_at: `${addDays(startsOn, offset)}T10:00:00.000Z`,
          });
        }
      }
      const qrVersion = 1 + (index % 3);
      if (!isArchived && index < activeTarget + expiredCount) {
        qrRows.push({ member_id: memberId, gym_id: gymId, public_code: qrPublicCode(index), version: qrVersion, enabled: true, changed_by: ownerId(createdUsers) });
      }
      if (index < Math.min(activeTarget, 420)) {
        const daysAgo = index % 21;
        attendanceRows.push({ id: randomUUID(), gym_id: gymId, member_id: memberId, membership_id: membershipId, direction: "entry", qr_version: qrVersion, scanned_by: ownerId(createdUsers), request_id: randomUUID(), occurred_at: `${addDays(today, -daysAgo)}T03:${String(index % 60).padStart(2, "0")}:00.000Z` });
        if (index % 3 === 0) attendanceRows.push({ id: randomUUID(), gym_id: gymId, member_id: memberId, membership_id: membershipId, direction: "exit", qr_version: qrVersion, scanned_by: ownerId(createdUsers), request_id: randomUUID(), occurred_at: `${addDays(today, -daysAgo)}T12:${String(index % 60).padStart(2, "0")}:00.000Z` });
      }
      if (index >= activeTarget && index < activeTarget + Math.min(expiredCount, 120)) {
        deniedRows.push({ id: randomUUID(), gym_id: gymId, member_id: memberId, membership_id: membershipId, qr_version: qrVersion, reason: "membership_expired", expires_on: expiresOn, scanned_by: ownerId(createdUsers), request_id: randomUUID(), occurred_at: `${addDays(today, -(index % 14))}T05:${String(index % 60).padStart(2, "0")}:00.000Z` });
      }
      if (index < activeTarget && index % 5 === 0) {
        reminderRows.push({ id: randomUUID(), gym_id: gymId, membership_id: membershipId, rule_id: null, scheduled_for: addDays(expiresOn, -7), status: index % 10 === 0 ? "failed" : "skipped", error: index % 10 === 0 ? "Synthetic failed reminder" : null });
      }
    }

    await insertMany("members", members);
    await insertMany("memberships", memberships);
    await insertMany("charges", charges);
    await insertMany("payments", payments);
    await upsertMany("member_qr_credentials", qrRows, "member_id");
    await insertMany("attendance_events", attendanceRows);
    await insertMany("denied_access_attempts", deniedRows);

    // Link reminder deliveries to the 7-day rule after it exists.
    const { data: ruleRows, error: rulesError } = await admin.from("reminder_rules").select("id,days_before").eq("gym_id", gymId);
    if (rulesError) throw rulesError;
    const sevenDayRule = ruleRows.find((row) => row.days_before === 7);
    if (sevenDayRule) await insertMany("reminder_deliveries", reminderRows.map((row) => ({ ...row, rule_id: sevenDayRule.id })));

    await admin.from("gyms").update({ next_member_number: membersTarget + 1, next_receipt_number: receipt }).eq("id", gymId);
    const manifest = {
      run_id: runId,
      gym_id: gymId,
      gym_name: gymName,
      created_at: new Date().toISOString(),
      password,
      counts: { members: members.length, active_memberships: activeTarget, payments: payments.length, attendance_events: attendanceRows.length, denied_attempts: deniedRows.length },
      users: createdUsers.map((item) => ({ email: item.email, role: item.role, user_id: item.user.id, display_name: item.display_name })),
    };
    await mkdir(path.dirname(manifestPath(runId)), { recursive: true });
    await writeFile(manifestPath(runId), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ ok: true, manifest: manifestPath(runId), ...manifest }, null, 2));
  } catch (error) {
    console.error(error);
    if (gymId) await admin.from("gyms").delete().eq("id", gymId).ilike("name", "FitKiro Load Test %");
    for (const item of createdUsers) await admin.auth.admin.deleteUser(item.user.id).catch(() => {});
    process.exit(1);
  }
}
function ownerId(createdUsers) { return createdUsers.find((item) => item.role === "owner")?.user.id ?? null; }

async function cleanup() {
  const manifestFile = arg("manifest");
  const gymIdArg = arg("gym-id");
  let gymId = gymIdArg;
  let runId = arg("run-id");
  if (manifestFile) {
    const manifest = JSON.parse(await readFile(path.resolve(manifestFile), "utf8"));
    gymId = manifest.gym_id;
    runId = manifest.run_id;
  }
  if (!gymId) throw new Error("Pass --manifest=<file> or --gym-id=<uuid>");
  const { data: gym, error } = await admin.from("gyms").select("id,name,owner_id").eq("id", gymId).maybeSingle();
  if (error) throw error;
  if (!gym) { console.log(JSON.stringify({ ok: true, deleted: false, reason: "gym_not_found", gym_id: gymId })); return; }
  if (!gym.name.startsWith("FitKiro Load Test ")) throw new Error(`Refusing to delete non-load-test gym: ${gym.name}`);
  const inferredRunId = gym.name.replace("FitKiro Load Test ", "").trim();
  runId ||= inferredRunId;
  const users = await listLoadTestUsers(runId);
  const childTables = [
    "denied_access_attempts",
    "attendance_corrections",
    "attendance_events",
    "reminder_deliveries",
    "payments",
    "charges",
    "member_qr_credentials",
    "memberships",
    "members",
    "reminder_rules",
    "plans",
    "gym_feature_flags",
    "gym_users",
  ];
  for (const table of childTables) {
    const { error: childError } = await admin.from(table).delete().eq("gym_id", gym.id);
    if (childError && !isMissingOptionalTable(childError)) throw new Error(`${table} cleanup failed: ${childError.message}`);
  }
  const { error: deleteError } = await admin.from("gyms").delete().eq("id", gym.id).ilike("name", "FitKiro Load Test %");
  if (deleteError) throw deleteError;
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
  console.log(JSON.stringify({ ok: true, deleted: true, gym_id: gym.id, gym_name: gym.name, deleted_auth_users: users.map((user) => user.email) }, null, 2));
}

if (command === "seed") await seed();
if (command === "cleanup") await cleanup();
