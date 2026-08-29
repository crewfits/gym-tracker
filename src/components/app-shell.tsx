"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, Dumbbell, LayoutDashboard, LogOut, Menu, ReceiptText, ScanLine, Settings, Tags, Users } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { BackButton } from "@/components/back-button";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/members", label: "Members", icon: Users },
  { href: "/reminders", label: "Reminders", icon: Bell },
  { href: "/attendance", label: "Attendance", icon: ScanLine },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/plans", label: "Plans", icon: Tags },
  { href: "/settings", label: "Settings", icon: Settings },
];

function logicalBackFallback(pathname: string): string {
  const memberTask = pathname.match(/^\/members\/([^/]+)\/(?:enroll|pay|qr|renew)$/);
  if (memberTask) return `/members/${memberTask[1]}`;
  if (/^\/members\/[^/]+$/.test(pathname) || pathname === "/members/new") return "/members";
  if (/^\/plans\/[^/]+\/edit$/.test(pathname)) return "/plans";
  if (/^\/receipts\/[^/]+$/.test(pathname)) return "/transactions";
  if (/^\/scan\/[^/]+$/.test(pathname)) return "/attendance";
  return "/";
}

export function AppShell({ gymName, children }: { gymName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [initialPath] = useState(pathname);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const scanMode = pathname.startsWith("/scan") || pathname.startsWith("/s/");
  const isNavigating = pendingHref !== null && pendingHref !== pathname;

  function markNavigating(href: string) {
    if (href !== pathname) setPendingHref(href);
  }

  return <div className={`app ${scanMode ? "scan-app" : ""}`}><aside className="sidebar"><div className="brand-row"><div className="brand"><span className="brand-mark"><Dumbbell size={20}/></span> GymDesk</div><details className="scan-menu"><summary aria-label="Open navigation"><Menu size={20}/></summary><div className="scan-menu-panel"><Link href="/attendance" onClick={() => markNavigating("/attendance")}><ScanLine size={17}/> Attendance</Link><Link href="/members" onClick={() => markNavigating("/members")}><Users size={17}/> Members</Link><Link href="/" onClick={() => markNavigating("/")}><LayoutDashboard size={17}/> Dashboard</Link><form action={signOut}><button><LogOut size={17}/> Sign out</button></form></div></details></div><nav className="nav">{links.map(({ href, label, icon: Icon }) => { const active = href === "/" ? pathname === "/" : pathname.startsWith(href); return <Link className={active ? "active" : undefined} href={href} key={href} onClick={() => markNavigating(href)}><Icon size={18}/> {label}</Link>; })}<form action={signOut}><button><LogOut size={18}/> Sign out</button></form></nav></aside><main className="main"><div className={`route-progress ${isNavigating ? "is-active" : ""}`} aria-hidden="true"/><header className="topbar"><span className="muted">Membership operations</span><strong>{gymName}</strong></header><div className="content" key={pathname}>{pathname !== "/" && <div className="route-back no-print"><BackButton fallback={logicalBackFallback(pathname)} useHistory={pathname !== initialPath}/></div>}{children}</div></main></div>;
}
