"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/return-path";
import { createClient } from "@/lib/supabase/server";

async function appOrigin() {
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (origin?.startsWith("http://") || origin?.startsWith("https://")) return origin.replace(/\/$/, "");

  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (host) {
    const proto = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function passwordResetErrorMessage(message: string) {
  return message.toLowerCase().includes("rate limit") ? "Too many reset emails were requested. Please wait a while and try again." : message;
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeReturnPath(formData.get("next"));
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function requestPasswordReset(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeReturnPath(formData.get("next"));

  if (!email) redirect(`/login?mode=reset&error=${encodeURIComponent("Enter the owner email to send a reset link.")}&next=${encodeURIComponent(next)}`);

  const redirectTo = `${await appOrigin()}/auth/callback?next=${encodeURIComponent("/update-password")}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) redirect(`/login?mode=reset&error=${encodeURIComponent(passwordResetErrorMessage(error.message))}&next=${encodeURIComponent(next)}`);

  redirect(`/login?mode=reset&reset=sent&success=${encodeURIComponent("If this email belongs to a GymDesk owner account, a reset link will be sent.")}&next=${encodeURIComponent(next)}`);
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) redirect(`/update-password?error=${encodeURIComponent("Password must be at least 8 characters.")}`);
  if (password !== confirmPassword) redirect(`/update-password?error=${encodeURIComponent("Passwords do not match.")}`);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/update-password?error=${encodeURIComponent(error.message)}`);

  await supabase.auth.signOut();
  redirect(`/login?success=${encodeURIComponent("Password updated. Sign in with the new password.")}`);
}

export async function signOut() { const supabase = await createClient(); await supabase.auth.signOut(); redirect("/login"); }
