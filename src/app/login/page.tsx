import { BarChart3, BellRing, LockKeyhole, QrCode, ShieldCheck, UserRound, Users, WalletCards } from "lucide-react";
import { requestPasswordReset } from "@/app/actions/auth";
import { AuthSignInForm } from "@/components/auth-sign-in-form";
import { Feedback } from "@/components/feedback";
import { safeReturnPath } from "@/lib/return-path";
import { SubmitButton } from "@/components/submit-button";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string; next?: string; reset?: string; success?: string }> }) {
  const p = await searchParams;
  const next = safeReturnPath(p.next);
  const resetMode = p.mode === "reset" || p.reset === "sent";

  return <main className="auth-page">
    <section className="auth-shell">
      <div className="auth-showcase">
        <div className="brand auth-brand">
          <span className="auth-logo-mark">FK</span>
          <span><strong>FitKiro</strong><small>Better every move</small></span>
        </div>
        <div className="auth-showcase-copy">
          <h1>Make fitness <span>happen.</span></h1>
          <p>Everything you need to manage members, track attendance, payments and automated reminders all in one place.</p>
        </div>
        <div className="auth-overview-panel" aria-hidden="true">
          <div className="auth-overview-head">
            <strong>Today&apos;s overview</strong>
            <span><i/> Live</span>
          </div>
          <div className="auth-overview-stats">
            <div><Users size={22}/><span>Members</span><strong>124</strong><em>↑ 12</em></div>
            <div><QrCode size={22}/><span>Check-ins</span><strong>98</strong><em>↑ 8</em></div>
            <div><WalletCards size={22}/><span>Revenue</span><strong>₹18,450</strong><em>↑ 18%</em></div>
            <div><BellRing size={22}/><span>Renewals due</span><strong>16</strong><em>This week</em></div>
          </div>
          <div className="auth-overview-chart">
            <svg viewBox="0 0 620 112" role="img" aria-label="Weekly gym activity trend">
              <path d="M18 84 C70 76 82 66 134 70 S218 53 258 56 322 28 380 45 442 30 494 26 550 58 604 22" fill="none" stroke="#a3e635" strokeWidth="4" strokeLinecap="round"/>
              <path d="M18 84 C70 76 82 66 134 70 S218 53 258 56 322 28 380 45 442 30 494 26 550 58 604 22 L604 104 L18 104 Z" fill="url(#authChartFill)"/>
              <defs>
                <linearGradient id="authChartFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#a3e635" stopOpacity=".24"/>
                  <stop offset="100%" stopColor="#a3e635" stopOpacity="0"/>
                </linearGradient>
              </defs>
            </svg>
            <div><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
          </div>
        </div>
        <div className="auth-feature-list">
          <div><UserRound size={20}/><span>Membership lifecycle</span><small>Plans, renewals and history</small></div>
          <div><QrCode size={20}/><span>QR check-ins</span><small>Fast attendance tracking</small></div>
          <div><BarChart3 size={20}/><span>Reports & insights</span><small>Know what needs action</small></div>
          <div><WalletCards size={20}/><span>Automated payment reminders</span><small>Recover dues on time</small></div>
        </div>
      </div>

      <div className="card auth-card">
        <div className="auth-intro auth-intro-signin">
          <div className="auth-lock-orb"><LockKeyhole size={26}/></div>
          <h1>Welcome</h1>
          <p className="muted">Sign in to your FitKiro gym dashboard</p>
        </div>
        <div className="auth-intro auth-intro-reset">
          <p className="eyebrow">Password reset</p>
          <h1>Reset your password.</h1>
          <p className="muted">Enter your email and we will send a secure reset link if the account exists.</p>
        </div>
        <Feedback error={resetMode ? undefined : p.error} success={resetMode ? undefined : p.success}/>

        <AuthSignInForm next={next}/>

        <details className="auth-reset" open={resetMode}>
          <summary>
            <span className="auth-reset-closed-label">Forgot password?</span>
            <span className="auth-reset-open-label">Back to sign in</span>
          </summary>
          <Feedback error={resetMode ? p.error : undefined} success={p.reset === "sent" ? p.success : undefined}/>
          <form className="form">
            <input type="hidden" name="next" value={next}/>
            <div className="field">
              <label htmlFor="reset-email">Email address</label>
              <input id="reset-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required/>
            </div>
            <SubmitButton className="button" formAction={requestPasswordReset} pendingLabel="Sending reset link...">Send reset link</SubmitButton>
          </form>
        </details>

        <div className="auth-note">
          <ShieldCheck size={15}/>
          <small>Secure. Reliable. Built for gyms.</small>
        </div>
      </div>
    </section>
  </main>;
}
