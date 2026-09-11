import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { csvRecords } from "./lib/csv-parser.mjs";
import { writeGymBackup } from "./lib/gym-backup.mjs";

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const gymId = argument("gym-id");
const file = resolve(argument("file") || "");
const apply = process.argv.includes("--apply");
const timestamp = new Date().toISOString().replaceAll(":", "-");
const reportPath = resolve(argument("report") || `${file}.report.json`);
const backupPath = resolve(argument("backup") || `${dirname(file)}/pre-import-${timestamp}.json`);

if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!gymId) throw new Error("Pass --gym-id=<uuid>");
if (!argument("file")) throw new Error("Pass --file=/path/to/members.csv");

const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const source = await readFile(file, "utf8");
const records = csvRecords(source);
const requiredHeaders = ["name", "phone", "is_archived"];
const headers = new Set(Object.keys(records[0]?.values ?? {}));
for (const header of requiredHeaders) if (!headers.has(header)) throw new Error(`CSV is missing required column: ${header}`);

async function allRows(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).eq("gym_id", gymId).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

const [plans, existingMembers] = await Promise.all([allRows("plans", "id,name"), allRows("members", "id,member_code,name,phone")]);
const planByName = new Map(plans.map((plan) => [plan.name.trim().toLowerCase(), plan]));
const phoneKey = (phone) => phone.replace(/\D/g, "");
const existingPhones = new Map(existingMembers.map((member) => [phoneKey(member.phone), member]));
const sourcePhoneCounts = new Map();
for (const record of records) sourcePhoneCounts.set(phoneKey(record.values.phone), (sourcePhoneCounts.get(phoneKey(record.values.phone)) ?? 0) + 1);

function booleanValue(value, field) {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  throw new Error(`${field} must be true/false, yes/no, or 1/0`);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function paise(value, field) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`${field} must be a non-negative amount with at most two decimals`);
  return Math.round(Number(value) * 100);
}

const issues = [];
const warnings = [];
const importRows = [];
for (const record of records) {
  const row = record.values;
  try {
    if (!row.name?.trim()) throw new Error("name is required");
    const normalizedPhone = phoneKey(row.phone ?? "");
    if (normalizedPhone.length < 7 || normalizedPhone.length > 15) throw new Error("phone must contain 7 to 15 digits");
    const allowShared = row.allow_shared_phone ? booleanValue(row.allow_shared_phone, "allow_shared_phone") : false;
    if ((sourcePhoneCounts.get(normalizedPhone) ?? 0) > 1 && !allowShared) throw new Error("duplicate phone in CSV; set allow_shared_phone=true on every intentional shared row");
    const existing = existingPhones.get(normalizedPhone);
    if (existing && !allowShared) throw new Error(`phone already belongs to ${existing.name} (${existing.member_code}); set allow_shared_phone=true only if intentional`);

    const archived = booleanValue(row.is_archived, "is_archived");
    const plan = row.plan_name ? planByName.get(row.plan_name.toLowerCase()) : null;
    if (!archived && !plan) throw new Error(row.plan_name ? `plan not found: ${row.plan_name}` : "current member requires plan_name");
    if (row.plan_name && !plan) throw new Error(`plan not found: ${row.plan_name}`);

    let totalPaise = null;
    let paidPaise = 0;
    if (plan) {
      for (const field of ["starts_on", "expires_on", "due_on"]) if (!validDate(row[field] ?? "")) throw new Error(`${field} must be a valid YYYY-MM-DD date`);
      if (row.expires_on < row.starts_on) throw new Error("expires_on cannot be before starts_on");
      if (!row.charge_total) throw new Error("charge_total is required when plan_name is present");
      totalPaise = paise(row.charge_total, "charge_total");
      paidPaise = row.paid_amount ? paise(row.paid_amount, "paid_amount") : 0;
      if (paidPaise > totalPaise) throw new Error("paid_amount cannot exceed charge_total");
      if (paidPaise > 0) {
        if (!["cash", "upi", "card", "bank_transfer"].includes(row.payment_method)) throw new Error("payment_method is required for paid_amount and must be cash, upi, card, or bank_transfer");
        if (!validDate(row.payment_date ?? "")) throw new Error("payment_date is required for paid_amount and must be YYYY-MM-DD");
      }
    } else if (["starts_on", "expires_on", "due_on", "charge_total", "paid_amount"].some((field) => row[field])) warnings.push({ row: record.rowNumber, message: "membership and financial columns were ignored because plan_name is blank" });

    importRows.push({
      name: row.name.trim(),
      phone: row.phone.trim(),
      email: row.email ?? "",
      notes: row.notes ?? "",
      is_archived: archived,
      plan_id: plan?.id ?? "",
      starts_on: plan ? row.starts_on : "",
      expires_on: plan ? row.expires_on : "",
      due_on: plan ? row.due_on : "",
      total_paise: totalPaise == null ? "" : String(totalPaise),
      paid_paise: String(paidPaise),
      payment_method: paidPaise > 0 ? row.payment_method : "",
      payment_date: paidPaise > 0 ? row.payment_date : "",
      payment_reference: paidPaise > 0 ? row.payment_reference ?? "" : "",
    });
  } catch (error) {
    issues.push({ row: record.rowNumber, message: error instanceof Error ? error.message : String(error) });
  }
}

const report = { generated_at: new Date().toISOString(), file, gym_id: gymId, mode: apply ? "apply" : "dry-run", source_rows: records.length, valid_rows: importRows.length, invalid_rows: issues.length, issues, warnings, applied_rows: 0, backup: null };
if (!apply || issues.length) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`${apply ? "Import blocked" : "Dry run complete"}: ${importRows.length} valid, ${issues.length} invalid, ${warnings.length} warnings`);
  console.log(`Report written to ${reportPath}`);
  if (apply && issues.length) process.exitCode = 1;
} else {
  await writeGymBackup(client, gymId, backupPath);
  report.backup = backupPath;
  const { data, error } = await client.rpc("admin_import_members", { p_gym_id: gymId, p_rows: importRows });
  if (error) throw new Error(`Atomic import failed; no rows were committed: ${error.message}`);
  report.applied_rows = Number(data?.imported ?? 0);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Imported ${report.applied_rows} members atomically`);
  console.log(`Pre-import backup: ${backupPath}`);
  console.log(`Report: ${reportPath}`);
}
