import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasAuthCode = request.nextUrl.searchParams.has("code");
  if (pathname === "/" && hasAuthCode) {
    const callback = new URL("/auth/callback", request.url);
    callback.searchParams.set("code", request.nextUrl.searchParams.get("code") ?? "");
    callback.searchParams.set("next", "/update-password");
    return NextResponse.redirect(callback);
  }

  const publicPath = pathname === "/login" || pathname === "/api/health" || pathname.startsWith("/auth/callback") || pathname.startsWith("/pass/") || pathname.startsWith("/p/") || pathname.startsWith("/r/");

  if (pathname.startsWith("/p/") || pathname.startsWith("/s/")) {
    const longPath = pathname.startsWith("/p/") ? `/pass/${pathname.slice(3)}` : `/scan/${pathname.slice(3)}`;
    const rewriteResponse = NextResponse.rewrite(new URL(`${longPath}${request.nextUrl.search}`, request.url));
    rewriteResponse.headers.set("Cache-Control", "private, no-store");
    return rewriteResponse;
  }

  if (publicPath) {
    const response = NextResponse.next({ request });
    if (pathname.startsWith("/pass/") || pathname.startsWith("/r/")) response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

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
  if (pathname.startsWith("/scan/")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
