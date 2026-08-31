import { Dumbbell } from "lucide-react";
import { updatePassword } from "@/app/actions/auth";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";

export default async function UpdatePassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const p = await searchParams;

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark"><Dumbbell size={20} /></span> FitKiro
        </div>
        <p className="eyebrow">Owner password reset</p>
        <h1>Set a new password.</h1>
        <p className="muted" style={{ marginBottom: 24 }}>Choose the password the gym owner will use from now on.</p>
        <Feedback error={p.error} />

        <form className="form">
          <div className="field">
            <label>New password</label>
            <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <SubmitButton className="button" formAction={updatePassword} pendingLabel="Updating password…">Update password</SubmitButton>
        </form>
      </div>
    </main>
  );
}
