import React from "react";
import { api } from "../api";
import { Icon } from "../ui";

export function Login({ allowSignup, onDone }: { allowSignup: boolean; onDone: () => void }) {
  const [mode, setMode] = React.useState<"in" | "up">("in");
  const [f, setF] = React.useState({ username: "", password: "", name: "" });
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await api(mode === "in" ? "/api/auth/login" : "/api/auth/signup", { body: f }); onDone(); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="login">
      <section className="login-art" aria-hidden="true">
        <div className="login-brand"><span className="brand-mark"><Icon name="book" size={17} /></span> The Reading Room</div>
        <blockquote>
          <p>“Reading without reflecting is like eating without digesting.”</p>
          <cite>Edmund Burke</cite>
        </blockquote>
        <ol className="loop">
          <li><b>Gather</b> Point at a blog and say what you want: “AI posts only”, or “all of it”.</li>
          <li><b>Read</b> In a quiet column, with an assistant in the margin.</li>
          <li><b>Check</b> A short quiz. Skip any question you like.</li>
          <li><b>Recall</b> One sentence from memory. Every day, spaced. Every note kept.</li>
        </ol>
        <div className="login-cards"><span /><span /><span /></div>
      </section>
      <section className="login-form">
        <form onSubmit={submit} className="card form">
          <h1 className="display">{mode === "in" ? "Welcome back." : "Pull up a chair."}</h1>
          <p className="muted">{mode === "in" ? "Sign in to your reading list." : "A username and a password are all it takes."}</p>
          {mode === "up" && (
            <label className="field"><span>Your name <small>(optional)</small></span>
              <input autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Madhu" /></label>
          )}
          <label className="field"><span>Username</span>
            <input required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="e.g. hanu" /></label>
          <label className="field"><span>Password</span>
            <input required type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={mode === "up" ? 6 : undefined} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn primary wide" disabled={busy}>{busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}</button>
          {allowSignup ? (
            <p className="swap">{mode === "in" ? "New here? " : "Have an account? "}
              <button type="button" className="linkbtn" onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(""); }}>{mode === "in" ? "Create an account" : "Sign in"}</button></p>
          ) : <p className="swap muted">Accounts are made by the admin.</p>}
          <p className="fine">Forgot your password? An admin can reset it for you.</p>
          <p className="fine">A <a href="https://carebun.com">carebun</a> app: small tools, made with care.</p>
        </form>
      </section>
    </div>
  );
}
