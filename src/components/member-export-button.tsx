"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";

export function MemberExportButton({ href }: { href: string }) {
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    const listener = (event: Event) => setUpdating(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("member-filter-updating", listener);
    return () => window.removeEventListener("member-filter-updating", listener);
  }, []);
  return updating
    ? <button className="button secondary" type="button" disabled title="Finish updating filters before exporting"><ArrowDownToLine size={16}/> Export this view</button>
    : <a className="button secondary" href={href}><ArrowDownToLine size={16}/> Export this view</a>;
}
