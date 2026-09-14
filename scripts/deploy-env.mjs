import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

const allowedEnvs = new Set(["dev", "prod"]);
const allowedActions = new Set(["preflight", "supabase:check", "supabase", "cloudflare", "all"]);
const [targetEnv, action] = process.argv.slice(2);

function usage() {
  console.log(`Usage:\n  node scripts/deploy-env.mjs <dev|prod> <preflight|supabase:check|supabase|cloudflare|all>\n\nExamples:\n  npm run deploy:dev:check\n  npm run deploy:dev:supabase\n  npm run deploy:dev:cloudflare\n  npm run deploy:prod:check\n  npm run deploy:prod:supabase\n  npm run deploy:prod:cloudflare`);
}

if (!allowedEnvs.has(targetEnv) || !allowedActions.has(action)) {
  usage();
  process.exit(1);
}

const envFile = path.join(process.cwd(), `.env.${targetEnv}.local`);
if (!existsSync(envFile)) throw new Error(`${envFile} is required. Copy .env.deploy.example and fill the ${targetEnv} values.`);

function parseEnvFile(file) {
  const result = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

const fileEnv = parseEnvFile(envFile);
const commandEnv = { ...process.env, ...fileEnv, FITKIRO_DEPLOY_TARGET: targetEnv };

function required(name) {
  const value = commandEnv[name];
  if (!value) throw new Error(`${name} is required in ${envFile}`);
  return value;
}

function projectRefFromSupabaseUrl(value) {
  const url = new URL(value);
  const host = url.hostname;
  if (!host.endsWith(".supabase.co")) throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a hosted Supabase URL");
  return host.split(".")[0];
}

function preflight() {
  const declaredEnv = required("FITKIRO_ENV");
  if (declaredEnv !== targetEnv) throw new Error(`Refusing deploy: FITKIRO_ENV=${declaredEnv} but command target is ${targetEnv}`);
  const appUrl = new URL(required("NEXT_PUBLIC_APP_URL"));
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  required("SUPABASE_SERVICE_ROLE_KEY");
  required("QR_SIGNING_SECRET");
  const projectRef = projectRefFromSupabaseUrl(supabaseUrl);
  if (commandEnv.SUPABASE_PROJECT_REF && commandEnv.SUPABASE_PROJECT_REF !== projectRef) {
    throw new Error(`SUPABASE_PROJECT_REF=${commandEnv.SUPABASE_PROJECT_REF} does not match URL project ${projectRef}`);
  }
  commandEnv.SUPABASE_PROJECT_REF = projectRef;

  if (targetEnv === "prod") {
    if (appUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(appUrl.hostname)) throw new Error("Prod NEXT_PUBLIC_APP_URL must be HTTPS and non-localhost");
    if (commandEnv.ALLOW_PROD_DEPLOY !== "yes") throw new Error("Set ALLOW_PROD_DEPLOY=yes in .env.prod.local to make prod deployment intentional");
  } else {
    if (appUrl.hostname === "musclefitness.fitkiro.com") throw new Error("Dev deploy must not use the production app URL");
  }
  console.log(`Preflight OK: ${targetEnv} -> Supabase ${projectRef}, app ${appUrl.origin}`);
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", env: commandEnv, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function supabaseCheck() {
  preflight();
  run("npx", ["supabase", "db", "push", "--project-ref", commandEnv.SUPABASE_PROJECT_REF, "--dry-run"]);
}

function supabaseDeploy() {
  preflight();
  run("npx", ["supabase", "db", "push", "--project-ref", commandEnv.SUPABASE_PROJECT_REF]);
}

function cloudflareDeploy() {
  preflight();
  run("npx", ["opennextjs-cloudflare", "build"]);
  run("npx", ["opennextjs-cloudflare", "deploy", "--env", targetEnv, "--keep-vars"]);
}

if (action === "preflight") preflight();
if (action === "supabase:check") supabaseCheck();
if (action === "supabase") supabaseDeploy();
if (action === "cloudflare") cloudflareDeploy();
if (action === "all") {
  supabaseCheck();
  supabaseDeploy();
  cloudflareDeploy();
}
