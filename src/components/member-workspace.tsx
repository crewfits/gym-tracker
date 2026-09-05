"use client";

import { useRef, useState, type ReactNode } from "react";
import { RefreshCw, UserRound } from "lucide-react";

export function MemberWorkspace({ profile, membership, initialView = "profile" }: { profile: ReactNode; membership: ReactNode; initialView?: "profile" | "membership" }) {
  const [view, setView] = useState(initialView);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const views = ["profile", "membership"] as const;

  return <div className="member-workspace">
    <div className="member-view-tabs" role="tablist" aria-label="Manage member">
      {views.map((item, index) => <button key={item} ref={(node) => { tabs.current[index] = node; }} type="button" role="tab" id={`member-${item}-tab`} aria-selected={view === item} aria-controls={`member-${item}-panel`} tabIndex={view === item ? 0 : -1} onClick={() => setView(item)} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        setView(views[next]);
        tabs.current[next]?.focus();
      }}>{item === "profile" ? <UserRound size={17}/> : <RefreshCw size={17}/>}{item === "profile" ? "Member details" : "Membership"}</button>)}
    </div>
    <div role="tabpanel" id="member-profile-panel" aria-labelledby="member-profile-tab" hidden={view !== "profile"}>{profile}</div>
    <div role="tabpanel" id="member-membership-panel" aria-labelledby="member-membership-tab" hidden={view !== "membership"}>{membership}</div>
  </div>;
}
