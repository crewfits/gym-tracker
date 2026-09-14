import { Dumbbell, LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";

export function AccessMessage({ title, message }: { title: string; message: string }) {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "linear-gradient(135deg,#10271c,#1c5136)" }}>
    <section className="card" style={{ width: "min(520px,100%)", padding: 32 }}>
      <div className="brand" style={{ color: "var(--ink)", margin: "0 0 28px" }}><span className="brand-mark"><Dumbbell size={20}/></span> FitKiro</div>
      <p className="eyebrow">Account access</p>
      <h1>{title}</h1>
      <p className="muted" style={{ marginBottom: 24 }}>{message}</p>
      <form action={signOut}><SubmitButton className="button secondary" pendingLabel="Signing out…"><LogOut size={17}/> Sign out</SubmitButton></form>
    </section>
  </main>;
}
