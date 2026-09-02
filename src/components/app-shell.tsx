"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type MouseEvent } from "react";
import { Bell, Camera, Dumbbell, LayoutDashboard, LogOut, Menu, ReceiptText, ScanLine, Settings, Tags, Users } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { BackButton } from "@/components/back-button";
import { SubmitButton } from "@/components/submit-button";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, scannerApp: false },
  { href: "/members", label: "Members", icon: Users, scannerApp: false },
  { href: "/reminders", label: "Reminders", icon: Bell, scannerApp: false },
  { href: "/scanner", label: "Scanner", icon: Camera, scannerApp: true },
  { href: "/attendance", label: "Attendance", icon: ScanLine, scannerApp: true },
  { href: "/transactions", label: "Transactions", icon: ReceiptText, scannerApp: false },
  { href: "/plans", label: "Plans", icon: Tags, scannerApp: false },
  { href: "/settings", label: "Settings", icon: Settings, scannerApp: false },
];

function logicalBackFallback(pathname: string): string {
  const memberTask = pathname.match(/^\/members\/([^/]+)\/(?:enroll|pay|qr|renew)$/);
  if (memberTask) return `/members/${memberTask[1]}`;
  if (/^\/members\/[^/]+$/.test(pathname) || pathname === "/members/new") return "/members";
  if (/^\/plans\/[^/]+\/edit$/.test(pathname)) return "/plans";
  if (/^\/receipts\/[^/]+$/.test(pathname)) return "/transactions";
  if (/^\/scan\/[^/]+$/.test(pathname) || pathname === "/scanner") return "/attendance";
  return "/";
}

function routeTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/members") return "Members";
  if (pathname === "/members/new") return "Add member";
  if (/^\/members\/[^/]+\/qr$/.test(pathname)) return "Member QR pass";
  if (/^\/members\/[^/]+\/pay$/.test(pathname)) return "Record payment";
  if (/^\/members\/[^/]+\/renew$/.test(pathname)) return "Renew membership";
  if (/^\/members\/[^/]+\/enroll$/.test(pathname)) return "Enroll member";
  if (/^\/members\/[^/]+$/.test(pathname)) return "Member profile";
  if (pathname === "/reminders") return "Reminders";
  if (pathname === "/attendance") return "Attendance";
  if (pathname === "/scanner") return "QR scanner";
  if (/^\/scan\/[^/]+$/.test(pathname) || /^\/s\/[^/]+$/.test(pathname)) return "QR attendance";
  if (pathname === "/transactions") return "Transactions";
  if (/^\/receipts\/[^/]+$/.test(pathname)) return "Payment receipt";
  if (pathname === "/plans") return "Membership plans";
  if (/^\/plans\/[^/]+\/edit$/.test(pathname)) return "Edit membership plan";
  if (pathname === "/settings") return "Gym settings";
  return "FitKiro";
}

function pathMatchesTarget(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function currentRoute(pathname: string, search: string): string {
  return `${pathname}${search ? `?${search}` : ""}`;
}

function routePath(route: string): string {
  return route.split("?")[0] || "/";
}

function RouteLoadingPreview() {
  return <div className="loading-page" aria-label="Loading page">
    <div className="loading-head">
      <span className="skeleton-line short"/>
      <span className="skeleton-line title"/>
    </div>
    <div className="loading-grid">
      <div className="card loading-card">
        <span className="skeleton-line medium"/>
        <span className="skeleton-block tall"/>
        <span className="skeleton-line"/>
        <span className="skeleton-line medium"/>
      </div>
      <div className="card loading-card">
        <span className="skeleton-line medium"/>
        <span className="skeleton-block"/>
        <span className="skeleton-line"/>
      </div>
    </div>
  </div>;
}

export function AppShell({ gymName, children }: { gymName: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentHref = currentRoute(pathname, search);
  const [initialPath] = useState(pathname);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isNavigating, startNavigation] = useTransition();
  const pendingTableRef = useRef<HTMLElement | null>(null);
  const scanMode = pathname.startsWith("/scan") || pathname.startsWith("/s/") || pathname === "/scanner";
  const activePath = isNavigating && pendingHref ? routePath(pendingHref) : pathname;
  const isQueryNavigation = Boolean(isNavigating && pendingHref && routePath(pendingHref) === pathname);

  useEffect(() => {
    if (isNavigating || !pendingTableRef.current) return;
    pendingTableRef.current.classList.remove("is-query-updating");
    pendingTableRef.current.removeAttribute("aria-busy");
    pendingTableRef.current = null;
  }, [isNavigating]);

  function markTablePending(source: Element) {
    const sortableHeader = document.querySelector<HTMLElement>(".sortable-heading");
    const table = source.closest<HTMLElement>(".table-wrap")
      ?? sortableHeader?.closest<HTMLElement>(".table-wrap")
      ?? document.querySelector<HTMLElement>(".table-wrap");
    if (!table) return;
    pendingTableRef.current?.classList.remove("is-query-updating");
    pendingTableRef.current?.removeAttribute("aria-busy");
    table.classList.add("is-query-updating");
    table.setAttribute("aria-busy", "true");
    pendingTableRef.current = table;
  }

  function handleInternalNavigation(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target || anchor.hasAttribute("download")) return;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return;
    const url = new URL(rawHref, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
    const targetHref = currentRoute(url.pathname, url.searchParams.toString());
    if (targetHref === currentHref) return;
    event.preventDefault();
    if (url.pathname === pathname) markTablePending(anchor);
    setPendingHref(targetHref);
    startNavigation(() => router.push(`${targetHref}${url.hash}`));
  }

  function handleQuerySubmit(event: FormEvent<HTMLDivElement>) {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    if (form.querySelector('input[name^="$ACTION"]')) return;
    const method = (form.getAttribute("method") ?? "get").toLowerCase();
    if (method !== "get" || form.target) return;
    const url = new URL(form.action || window.location.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
    const query = new URLSearchParams();
    for (const [name, value] of new FormData(form)) if (typeof value === "string") query.append(name, value);
    const targetHref = currentRoute(url.pathname, query.toString());
    if (targetHref === currentHref) return;
    event.preventDefault();
    if (url.pathname === pathname) markTablePending(form);
    setPendingHref(targetHref);
    startNavigation(() => router.push(targetHref, { scroll: false }));
  }

  return <div className={`app ${scanMode ? "scan-app" : ""}`} onClick={handleInternalNavigation} onSubmit={handleQuerySubmit}><aside className="sidebar"><div className="brand-row"><div className="brand"><span className="brand-mark"><Dumbbell size={20}/></span> FitKiro</div><details className="scan-menu"><summary aria-label="Open navigation"><Menu size={20}/></summary><div className="scan-menu-panel"><Link href="/scanner"><Camera size={17}/> Scanner</Link><Link href="/attendance"><ScanLine size={17}/> Attendance</Link><Link className="pwa-full-app-only" href="/members"><Users size={17}/> Members</Link><Link className="pwa-full-app-only" href="/"><LayoutDashboard size={17}/> Dashboard</Link><form action={signOut}><SubmitButton pendingLabel="Signing out…"><LogOut size={17}/> Sign out</SubmitButton></form></div></details></div><nav className="nav">{links.map(({ href, label, icon: Icon, scannerApp }) => { const active = pathMatchesTarget(activePath, href); return <Link className={`${active ? "active" : ""}${scannerApp ? "" : " pwa-full-app-only"}`.trim() || undefined} href={href} key={href}><Icon size={18}/> {label}</Link>; })}<form action={signOut}><SubmitButton pendingLabel="Signing out…"><LogOut size={18}/> Sign out</SubmitButton></form></nav></aside><main className="main"><div className={`route-progress ${isNavigating && !isQueryNavigation ? "is-active" : ""}`} aria-hidden="true"/><header className="topbar"><div className="topbar-page">{pathname !== "/" && <BackButton fallback={logicalBackFallback(pathname)} useHistory={pathname !== initialPath}/>}<strong className="topbar-title">{routeTitle(activePath)}</strong></div><strong className="topbar-gym">{gymName}</strong></header><div className="content">{isNavigating && !isQueryNavigation ? <RouteLoadingPreview/> : children}</div></main></div>;
}
