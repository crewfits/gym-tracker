function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const appUrl = new URL(required("NEXT_PUBLIC_APP_URL"));
const supabaseUrl = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
required("SUPABASE_SERVICE_ROLE_KEY");
const qrSecret = required("QR_SIGNING_SECRET");

if (appUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(appUrl.hostname)) throw new Error("NEXT_PUBLIC_APP_URL must be the production HTTPS origin");
if (supabaseUrl.protocol !== "https:" || !supabaseUrl.hostname.endsWith(".supabase.co")) throw new Error("NEXT_PUBLIC_SUPABASE_URL must be the linked hosted Supabase project");
if (Buffer.byteLength(qrSecret) < 32) throw new Error("QR_SIGNING_SECRET must contain at least 32 bytes");
if (process.env.FITKIRO_OWNER_PASSWORD) throw new Error("Remove the provisioning-only FITKIRO_OWNER_PASSWORD from production runtime variables");

console.log("Production environment preflight passed without printing secret values.");
