"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(`${result.error || "Authentication failed."}${result.referenceId ? ` Reference: ${result.referenceId}` : ""}`);
      router.replace("/"); router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete your request.");
    } finally { setBusy(false); }
  }

  return <main className={`auth-shell ${registering ? "register-page" : "login-page"}`}>
    <Link className="auth-brand" href="/">Waste System</Link>
    <section className="auth-card">
      {registering && <div className="eyebrow">Your circular city account</div>}
      <h1>{registering ? "Create your account" : "Sign in to your account"}</h1>
      <p className="muted">{registering ? "Join Waste System and keep your recycling activity together." : "Welcome back. Enter your email and password to continue."}</p>
      <form className="auth-form" onSubmit={submit}>
        {registering && <label className="field">Full name<input name="name" autoComplete="name" minLength={2} maxLength={80} required /></label>}
        <label className="field">Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <label className="field">Password<input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : 1} maxLength={128} required />{registering && <span className="field-hint">Use at least 12 characters.</span>}</label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="connect auth-submit" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
      </form>
      <p className="auth-switch">{registering ? "Already have an account?" : "New to Waste System?"} <Link href={registering ? "/login" : "/register"}>{registering ? "Sign in" : "Create an account"}</Link></p>
    </section>
    <p className="auth-foot">Your account is stored on this server.</p>
  </main>;
}
