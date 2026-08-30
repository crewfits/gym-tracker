import { Dumbbell } from "lucide-react";
import { requestPasswordReset, signIn } from "@/app/actions/auth";
import { Feedback } from "@/components/feedback";
import { safeReturnPath } from "@/lib/return-path";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string; next?: string; reset?: string; success?: string }> }) {
  const p = await searchParams;
  const next = safeReturnPath(p.next);
  const resetMode = p.mode === "reset" || p.reset === "sent";

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark"><Dumbbell size={20} /></span> FitKiro
        </div>
        <div className="auth-intro auth-intro-signin">
          <p className="eyebrow">Provisioned owner access</p>
          <h1>Welcome back.</h1>
          <p className="muted">Use the owner account issued for your gym.</p>
        </div>
        <div className="auth-intro auth-intro-reset">
          <p className="eyebrow">Password reset</p>
          <h1>Reset owner access.</h1>
          <p className="muted">Enter the owner email and we will send a secure reset link if the account exists.</p>
        </div>
        <Feedback error={resetMode ? undefined : p.error} success={resetMode ? undefined : p.success} />

        <form className="form auth-signin">
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label>Email</label>
            <input name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input name="password" type="password" autoComplete="current-password" minLength={8} required />
          </div>
          <button className="button" formAction={signIn}>Sign in</button>
        </form>

        <details className="auth-reset" open={resetMode}>
          <summary>
            <span className="auth-reset-closed-label">Forgot or change password?</span>
            <span className="auth-reset-open-label">Back to sign in</span>
          </summary>
          <Feedback error={resetMode ? p.error : undefined} success={p.reset === "sent" ? p.success : undefined} />
          <form className="form">
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label>Owner email</label>
              <input name="email" type="email" autoComplete="email" required />
            </div>
            <button className="button" formAction={requestPasswordReset}>Send reset link</button>
          </form>
        </details>

        <div className="auth-note">
          <small>New gym accounts are created by the FitKiro team</small>
        </div>
      </div>
    </main>
  );
}
