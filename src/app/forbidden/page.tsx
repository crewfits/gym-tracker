import Link from "next/link";

export default function ForbiddenPage() {
  return <main className="auth-page">
    <section className="card form" style={{ maxWidth: 520, margin: "auto" }}>
      <p className="eyebrow">Access restricted</p>
      <h1>This area is not available for your role.</h1>
      <p className="muted">Ask the gym owner if your staff access needs to be changed.</p>
      <Link className="button" href="/">Back to FitKiro</Link>
    </section>
  </main>;
}
