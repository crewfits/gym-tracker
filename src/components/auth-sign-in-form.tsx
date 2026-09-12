"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { signIn } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";

const rememberedEmailKey = "fitkiro.login.email";
const rememberPreferenceKey = "fitkiro.login.remember";

type Props = {
  next: string;
};

function initialRememberPreference() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(rememberPreferenceKey) !== "false";
}

function initialEmail() {
  if (typeof window === "undefined" || !initialRememberPreference()) return "";
  return window.localStorage.getItem(rememberedEmailKey) ?? "";
}

export function AuthSignInForm({ next }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [remember, setRemember] = useState(initialRememberPreference);
  const [showPassword, setShowPassword] = useState(false);

  function rememberLoginChoice() {
    window.localStorage.setItem(rememberPreferenceKey, String(remember));
    if (remember) window.localStorage.setItem(rememberedEmailKey, email.trim());
    else window.localStorage.removeItem(rememberedEmailKey);
  }

  return <form action={signIn} className="form auth-signin" onSubmit={rememberLoginChoice}>
    <input type="hidden" name="next" value={next}/>
    <div className="field">
      <label htmlFor="login-email">Email</label>
      <div className="auth-input-wrap">
        <Mail size={18}/>
        <input id="login-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="Enter your email" value={email} onChange={(event) => setEmail(event.target.value)} suppressHydrationWarning required/>
      </div>
    </div>
    <div className="field">
      <label htmlFor="login-password">Password</label>
      <div className="auth-input-wrap">
        <LockKeyhole size={18}/>
        <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={8} placeholder="Enter your password" required/>
        <button className="auth-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
          {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
        </button>
      </div>
    </div>
    <div className="auth-form-row">
      <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} suppressHydrationWarning/> <span><Check size={13}/></span> Remember me</label>
    </div>
    <SubmitButton className="button auth-signin-button" pendingLabel="Signing in...">Sign in</SubmitButton>
  </form>;
}
