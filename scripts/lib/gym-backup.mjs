import { writeFile } from "node:fs/promises";

const gymTables = [
  "members",
  "plans",
  "memberships",
  "charges",
  "payment_operations",
  "payments",
  "payment_reversals",
  "member_qr_credentials",
  "attendance_events",
  "denied_access_attempts",
  "manual_reminder_events",
];

async function allRows(client, table, column, value) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").eq(column, value).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function gymBackup(client, gymId) {
  const gyms = await allRows(client, "gyms", "id", gymId);
  if (gyms.length !== 1) throw new Error("Gym not found");
  const tables = { gyms };
  for (const table of gymTables) tables[table] = await allRows(client, table, "gym_id", gymId);
  return { format: "fitkiro-gym-backup", version: 1, created_at: new Date().toISOString(), gym_id: gymId, tables };
}

export async function writeGymBackup(client, gymId, outputPath) {
  const backup = await gymBackup(client, gymId);
  await writeFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return backup;
}
