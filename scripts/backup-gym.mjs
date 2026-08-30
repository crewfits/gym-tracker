import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { writeGymBackup } from "./lib/gym-backup.mjs";

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const gymId = argument("gym-id");
const output = resolve(argument("output") || `fitkiro-backup-${gymId}-${new Date().toISOString().replaceAll(":", "-")}.json`);

if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!gymId) throw new Error("Pass --gym-id=<uuid>");
const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const backup = await writeGymBackup(client, gymId, output);
console.log(`Backup written to ${output}`);
console.log(Object.entries(backup.tables).map(([table, rows]) => `${table}: ${rows.length}`).join("\n"));
