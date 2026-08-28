import { NextResponse, type NextRequest } from "next/server";
import { safeReturnPath } from "@/lib/return-path";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeReturnPath(searchParams.get("next") ?? "/");

  if (!code) {
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "Password reset link is missing a verification code.");
    return NextResponse.redirect(login);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const login = new URL("/login", request.url);
    login.searchParams.set("error", error.message);
    return NextResponse.redirect(login);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
