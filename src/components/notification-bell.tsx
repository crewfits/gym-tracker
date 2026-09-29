"use client";

import { Bell, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type NotificationBellEvent = {
  id: string;
  kind: string;
  status: string;
  to_email: string;
  created_at: string;
  display_time: string;
  members: { name: string; member_code: string } | { name: string; member_code: string }[] | null;
};

export function NotificationBell({ events }: { events: NotificationBellEvent[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return <div className="notification-bell" ref={ref}>
    <button type="button" aria-label="Recent reminder notifications" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={17}/>{events.length > 0 && <span>{events.length}</span>}
    </button>
    {open && <div className="notification-popover">
      <strong>Recent reminders</strong>
      <div>{events.map((event) => {
        const member = Array.isArray(event.members) ? event.members[0] : event.members;
        return <div className={`notification-item ${event.status}`} key={event.id}>
          <span><Mail size={14}/></span>
          <p><b>{member?.name ?? event.to_email}</b><small>{emailKindLabel(event.kind)} · {event.display_time}</small></p>
          <em>{event.status === "sent" ? "Sent" : "Failed"}</em>
        </div>;
      })}{!events.length && <small className="muted">No email reminders sent yet.</small>}</div>
    </div>}
  </div>;
}

function emailKindLabel(kind: string) {
  return kind === "membership_expired" ? "Expired membership" : "Expiring membership";
}
