import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
function env(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function yesterdayIso() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function chunk(items, size = 100) { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function usage() {
  console.log(`Usage:\n  npm run testdata:scanner-load -- --confirm --manifest=tmp/load-test-<run-id>.json [--duration-minutes=60] [--scans=1200] [--expire-after=600] [--expire-count=30] [--scanner-role=trainer]\n\nRequires .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.`);
}

if (hasFlag("help")) { usage(); process.exit(0); }
if (!hasFlag("confirm")) throw new Error("Pass --confirm so scanner load cannot run accidentally.");

async function resolveManifestFile() {
  const explicit = arg("manifest");
  if (explicit) return path.resolve(explicit);
  const tmpDir = path.join(process.cwd(), "tmp");
  const files = (await readdir(tmpDir).catch(() => [])).filter((name) => /^load-test-.+\.json$/.test(name));
  if (!files.length) throw new Error("No load-test manifest found. Pass --manifest=tmp/load-test-<run-id>.json or rerun testdata:load:seed.");
  const withStats = await Promise.all(files.map(async (name) => {
    const file = path.join(tmpDir, name);
    const stat = await import("node:fs/promises").then((fs) => fs.stat(file));
    return { file, mtimeMs: stat.mtimeMs };
  }));
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStats[0].file;
}

const manifestFile = await resolveManifestFile();
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
if (!manifest.gym_name?.startsWith("FitKiro Load Test ")) throw new Error(`Refusing scanner load for non-load-test gym: ${manifest.gym_name}`);

const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const scanner = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const durationMinutes = Number(arg("duration-minutes", "60"));
const requestedScans = Number(arg("scans", "1200"));
const expireAfter = Number(arg("expire-after", "600"));
const expireCount = Number(arg("expire-count", "30"));
const scannerRole = arg("scanner-role", "trainer");
const password = arg("password", manifest.password ?? "FitKiroLoadTest#2026");
const dryRun = hasFlag("dry-run");
const progressEvery = Number(arg("progress-every", "25"));
if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("--duration-minutes must be positive");
if (!Number.isInteger(requestedScans) || requestedScans < 2) throw new Error("--scans must be at least 2");
if (!Number.isInteger(expireAfter) || expireAfter < 0) throw new Error("--expire-after must be zero or greater");
if (!Number.isInteger(expireCount) || expireCount < 0) throw new Error("--expire-count must be zero or greater");
if (!Number.isInteger(progressEvery) || progressEvery < 1) throw new Error("--progress-every must be at least 1");

const scannerUser = manifest.users.find((user) => user.role === scannerRole) ?? manifest.users.find((user) => user.role === "trainer") ?? manifest.users.find((user) => user.role === "owner");
if (!scannerUser?.email) throw new Error(`No scanner user found for role ${scannerRole}`);

const { data: gym, error: gymError } = await admin.from("gyms").select("id,name").eq("id", manifest.gym_id).maybeSingle();
if (gymError) throw gymError;
if (!gym?.name?.startsWith("FitKiro Load Test ")) throw new Error("Load-test gym no longer exists or is not safe to target");

const { data: login, error: loginError } = await scanner.auth.signInWithPassword({ email: scannerUser.email, password });
if (loginError) throw new Error(`Could not sign in scanner user ${scannerUser.email}: ${loginError.message}`);
if (!login.session) throw new Error("Scanner sign-in did not return a session");

const { data: activeRows, error: activeError } = await admin
  .from("memberships")
  .select("id,member_id,starts_on,expires_on,members!inner(id,member_code,name,is_archived)")
  .eq("gym_id", manifest.gym_id)
  .lte("starts_on", todayIso())
  .gte("expires_on", todayIso())
  .eq("members.is_archived", false)
  .order("expires_on", { ascending: true })
  .limit(1000);
if (activeError) throw activeError;
const memberIds = [...new Set((activeRows ?? []).map((row) => row.member_id))];
const qrRows = [];
for (const memberIdChunk of chunk(memberIds, 100)) {
  const { data, error } = await admin
    .from("member_qr_credentials")
    .select("member_id,public_code,version,enabled")
    .eq("gym_id", manifest.gym_id)
    .eq("enabled", true)
    .in("member_id", memberIdChunk);
  if (error) throw error;
  qrRows.push(...(data ?? []));
}
const qrByMember = new Map(qrRows.map((row) => [row.member_id, row]));
const activeMembers = (activeRows ?? []).flatMap((row) => {
  const qr = qrByMember.get(row.member_id);
  if (!qr) return [];
  return [{ membershipId: row.id, memberId: row.member_id, memberCode: row.members.member_code, publicCode: qr.public_code, version: qr.version }];
});
if (activeMembers.length < 2) throw new Error("Need at least 2 active QR-enabled members to run scanner load");

const scanPlan = [];
for (let index = 0; index < requestedScans; index++) {
  const cycle = Math.floor(index / activeMembers.length);
  const member = activeMembers[index % activeMembers.length];
  scanPlan.push({ ...member, direction: cycle % 2 === 0 ? "entry" : "exit" });
}
const intervalMs = Math.max(0, Math.floor((durationMinutes * 60 * 1000) / scanPlan.length));
const toExpire = activeMembers.slice(0, Math.min(expireCount, activeMembers.length));
const results = [];
let expired = false;
let recorded = 0;
let denied = 0;
let duplicates = 0;
let failed = 0;

const startedAt = new Date().toISOString();
console.log(JSON.stringify({ ok: true, dry_run: dryRun, gym: gym.name, scanner: scannerUser.email, active_members: activeMembers.length, planned_scans: scanPlan.length, interval_ms: intervalMs, expire_after: expireAfter, expire_count: toExpire.length }, null, 2));

for (let index = 0; index < scanPlan.length; index++) {
  if (!expired && expireAfter > 0 && index >= expireAfter && toExpire.length) {
    const { error: expireError } = await admin.from("memberships").update({ expires_on: yesterdayIso() }).in("id", toExpire.map((item) => item.membershipId)).eq("gym_id", manifest.gym_id);
    if (expireError) throw new Error(`Could not expire synthetic memberships: ${expireError.message}`);
    expired = true;
    console.log(JSON.stringify({ event: "expired_memberships", at_scan: index, count: toExpire.length }));
  }
  const item = scanPlan[index];
  const requestId = randomUUID();
  const started = performance.now();
  let status = "failed";
  let message = "";
  if (dryRun) {
    status = "dry_run";
  } else {
    const { data, error } = await scanner.rpc("process_qr_access", {
      p_member_id: item.memberId,
      p_qr_version: item.version,
      p_request_id: requestId,
      p_direction: item.direction,
    });
    if (error) {
      failed += 1;
      message = error.message;
    } else if (data?.status === "recorded") {
      recorded += 1;
      status = "recorded";
      if (data.event?.request_id !== requestId) duplicates += 1;
    } else if (data?.status === "denied") {
      denied += 1;
      status = "denied";
    } else {
      failed += 1;
      message = `Unexpected result: ${JSON.stringify(data)}`;
    }
  }
  const latencyMs = Math.round(performance.now() - started);
  results.push({ index: index + 1, member_code: item.memberCode, direction: item.direction, status, latency_ms: latencyMs, message });
  if ((index + 1) % progressEvery === 0 || index === scanPlan.length - 1) {
    const latencies = results.filter((row) => row.status !== "dry_run" && row.latency_ms >= 0).map((row) => row.latency_ms);
    console.log(JSON.stringify({ progress: index + 1, recorded, denied, failed, p50_ms: percentile(latencies, 50), p95_ms: percentile(latencies, 95) }));
  }
  if (index < scanPlan.length - 1 && intervalMs > 0) await sleep(intervalMs);
}

const endedAt = new Date().toISOString();
const latencies = results.filter((row) => row.status !== "dry_run").map((row) => row.latency_ms);
const report = {
  manifest: manifestFile,
  gym_id: manifest.gym_id,
  gym_name: gym.name,
  scanner: scannerUser.email,
  started_at: startedAt,
  ended_at: endedAt,
  planned_scans: scanPlan.length,
  active_members_sampled: activeMembers.length,
  expired_memberships_mid_run: expired ? toExpire.map((item) => item.membershipId) : [],
  counts: { recorded, denied, failed, duplicates },
  latency_ms: { min: Math.min(...latencies), p50: percentile(latencies, 50), p95: percentile(latencies, 95), p99: percentile(latencies, 99), max: Math.max(...latencies) },
  recent_failures: results.filter((row) => row.status === "failed").slice(-20),
};
const reportFile = path.join(process.cwd(), "tmp", `scanner-load-${manifest.run_id}-${Date.now()}.json`);
await mkdir(path.dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify({ ...report, results }, null, 2));
console.log(JSON.stringify({ ok: failed === 0, report: reportFile, ...report }, null, 2));
