import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeReturnPath } from "@/lib/return-path";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items, headers) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const publicPath = pathname === "/login" || pathname === "/api/health" || pathname.startsWith("/pass/") || pathname.startsWith("/p/") || pathname.startsWith("/r/");
  if (!user && !publicPath) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    const loginResponse = NextResponse.redirect(login);
    response.cookies.getAll().forEach((cookie) => loginResponse.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) loginResponse.headers.set(header, value);
    }
    return loginResponse;
  }
  if (user && pathname === "/login") {
    const next = request.nextUrl.searchParams.get("next");
    const destination = safeReturnPath(next);
    const redirectResponse = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirectResponse.headers.set(header, value);
    }
    return redirectResponse;
  }
  if (pathname.startsWith("/p/") || pathname.startsWith("/s/")) {
    const longPath = pathname.startsWith("/p/") ? `/pass/${pathname.slice(3)}` : `/scan/${pathname.slice(3)}`;
    const rewriteResponse = NextResponse.rewrite(new URL(`${longPath}${request.nextUrl.search}`, request.url));
    response.cookies.getAll().forEach((cookie) => rewriteResponse.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) rewriteResponse.headers.set(header, value);
    }
    rewriteResponse.headers.set("Cache-Control", "private, no-store");
    return rewriteResponse;
  }
  if (pathname.startsWith("/pass/") || pathname.startsWith("/scan/") || pathname.startsWith("/r/")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
