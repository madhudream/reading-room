import React from "react";
import { api } from "../api";
import { toast, type Me } from "../ui";

export function Account({ me }: { me: Me }) {
  const [f, setF] = React.useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.again) { toast("The new passwords don’t match.", "err"); return; }
    setBusy(true);
    try { await api("/api/auth/password", { body: { current: f.current, next: f.next } }); toast("Password changed. Other devices were signed out.", "ok"); setF({ current: "", next: "", again: "" }); }
    catch (x) { toast((x as Error).message, "err"); }
    finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <header className="page-head"><div><p className="eyebrow">Account</p><h1 className="display">{me.name}</h1><p className="lede">@{me.username} · {me.role}</p></div></header>
      <form className="card form" onSubmit={submit}>
        <h2>Change password</h2>
        <label className="field"><span>Current password</span><input type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label className="field"><span>New password</span><input type="password" required minLength={6} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></label>
        <label className="field"><span>New password, again</span><input type="password" required minLength={6} autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></label>
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
      </form>
      <section className="card form" id="extension">
        <h2>Chrome extension</h2>
        <p className="muted">Read on the original site and still keep the time: a small pill appears on any article in your list with <b>Start reading</b>, a timer that runs only while that tab is focused, and <b>I’ve finished</b>, which logs the minutes and opens the quiz and recall here. Your list is matched on your computer; your browsing is never sent anywhere.</p>
        <ol className="steps">
          <li><a className="btn primary sm" href="/reading-room-extension.zip" download>Download the extension</a> and unzip it.</li>
          <li>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b> (top right).</li>
          <li>Click <b>Load unpacked</b> and choose the unzipped folder.</li>
          <li>Pin it, click it, and sign in with your Reading Room username and password.</li>
        </ol>
      </section>
      <form className="card form" onSubmit={async (e) => { e.preventDefault(); await api("/api/auth/logout", { method: "POST" }); location.href = "/"; }}>
        <h2>Sign out</h2><p className="muted">Your list, notes and conversations stay in your account.</p>
        <button className="btn ghost">Sign out</button>
      </form>
    </div>
  );
}
