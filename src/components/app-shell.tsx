"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dumbbell, LayoutDashboard, LogOut, ReceiptText, Settings, Tags, Users } from "lucide-react";
import { signOut } from "@/app/actions/auth";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/members", label: "Members", icon: Users },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/plans", label: "Plans", icon: Tags },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ gymName, children }: { gymName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="app"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Dumbbell size={20}/></span> GymDesk</div><nav className="nav">{links.map(({ href, label, icon: Icon }) => { const active = href === "/" ? pathname === "/" : pathname.startsWith(href); return <Link className={active ? "active" : undefined} href={href} key={href}><Icon size={18}/> {label}</Link>; })}<form action={signOut}><button><LogOut size={18}/> Sign out</button></form></nav></aside><main className="main"><header className="topbar"><span className="muted">Membership operations</span><strong>{gymName}</strong></header><div className="content" key={pathname}>{children}</div></main></div>;
}
