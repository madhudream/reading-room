import React from "react";
import { api, ago } from "../api";
import { Icon, Spinner, toast, useAsync, type Me } from "../ui";

interface U { username: string; name?: string; role: "admin" | "learner"; created: number; lastLogin: number; items: number; notes: number }

export function Admin({ me }: { me: Me }) {
  const { data, loading, error, reload } = useAsync(() => api<{ users: U[] }>("/api/admin/users"), []);
  const [issued, setIssued] = React.useState<{ username: string; password: string } | null>(null);
  const [nu, setNu] = React.useState({ username: "", name: "", password: "", role: "learner" });
  const reset = async (u: U) => {
    const custom = prompt(`New password for @${u.username}\n(leave empty to generate one)`, "");
    if (custom === null) return;
    try { const r = await api<{ username: string; password: string }>("/api/admin/reset", { body: { username: u.username, password: custom } }); setIssued(r); toast(`Password reset for @${u.username}`, "ok"); }
    catch (e) { toast((e as Error).message, "err"); }
  };
  const role = async (u: U) => {
    const next = u.role === "admin" ? "learner" : "admin";
    if (!confirm(`Make @${u.username} ${next === "admin" ? "an admin" : "a learner"}?`)) return;
    try { await api("/api/admin/role", { body: { username: u.username, role: next } }); reload(); } catch (e) { toast((e as Error).message, "err"); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const r = await api<{ username: string; password: string }>("/api/admin/create", { body: nu }); setIssued(r); setNu({ username: "", name: "", password: "", role: "learner" }); reload(); }
    catch (x) { toast((x as Error).message, "err"); }
  };
  return (
    <div className="page">
      <header className="page-head"><div><p className="eyebrow">Admin</p><h1 className="display">Readers</h1><p className="lede">Reset a password, make an account, or share the keys.</p></div></header>
      {issued && (
        <div className="card issued" role="status">
          <Icon name="key" size={22} />
          <div><b>@{issued.username}</b>’s password is now <code className="pw">{issued.password}</code><p className="muted small">Shown once. Send it to them privately; they can change it under Account. All their other sessions were signed out.</p></div>
          <button className="btn ghost sm" onClick={() => { void navigator.clipboard?.writeText(issued.password); toast("Copied"); }}>Copy</button>
          <button className="iconbtn" onClick={() => setIssued(null)} aria-label="Dismiss"><Icon name="x" /></button>
        </div>
      )}
      {loading && !data ? <Spinner /> : error ? <p className="err">{error}</p> : (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Reader</th><th>Role</th><th className="num">Items</th><th className="num">Notes</th><th>Last seen</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {data!.users.map((u) => (
                <tr key={u.username}>
                  <td><span className="avatar sm">{(u.name || u.username).charAt(0).toUpperCase()}</span> <b>{u.name || u.username}</b> <span className="muted">@{u.username}</span></td>
                  <td><span className={`pill ${u.role === "admin" ? "" : "moss"}`}>{u.role}</span></td>
                  <td className="num">{u.items}</td><td className="num">{u.notes}</td>
                  <td className="muted">{ago(u.lastLogin)}</td>
                  <td className="actions">
                    <button className="btn ghost sm" onClick={() => reset(u)}><Icon name="key" size={14} /> Reset password</button>
                    {u.username !== me.username && <button className="linkbtn" onClick={() => role(u)}>{u.role === "admin" ? "Make learner" : "Make admin"}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="card form row-form" onSubmit={create}>
        <h2>New account</h2>
        <label className="field"><span>Username</span><input required value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} autoCapitalize="none" /></label>
        <label className="field"><span>Name</span><input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} /></label>
        <label className="field"><span>Password <small>(blank = generate)</small></span><input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></label>
        <label className="field"><span>Role</span><select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}><option value="learner">Learner</option><option value="admin">Admin</option></select></label>
        <button className="btn primary">Create</button>
      </form>
    </div>
  );
}
