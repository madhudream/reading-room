import React from "react";
import { createRoot } from "react-dom/client";
import { api, go } from "./api";
import { BootCtx, Icon, Link, Spinner, Toast, type Boot, type Me } from "./ui";
import { Login } from "./pages/Login";
import { Today } from "./pages/Today";
import { Library } from "./pages/Library";
import { Add } from "./pages/Add";
import { Reader } from "./pages/Reader";
import { RecallSession } from "./pages/Recall";
import { Notebook } from "./pages/Notebook";
import { Assistant } from "./pages/Assistant";
import { Admin } from "./pages/Admin";
import { Account } from "./pages/Account";
import { Discover, DiscoverOne } from "./pages/Discover";


function usePath() {
  const [path, setPath] = React.useState(location.pathname + location.search);
  React.useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    window.addEventListener("popstate", on); window.addEventListener("lms:navigate", on);
    return () => { window.removeEventListener("popstate", on); window.removeEventListener("lms:navigate", on); };
  }, []);
  return path;
}

function ThemeToggle() {
  const [dark, setDark] = React.useState(() => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  const flip = () => {
    const t = dark ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch { /* private mode */ }
    setDark(!dark);
  };
  return <button className="iconbtn" onClick={flip} aria-label={dark ? "Light theme" : "Dark theme"} title={dark ? "Light theme" : "Dark theme"}><Icon name={dark ? "sun" : "moon"} /></button>;
}

const NAV = [
  { to: "/", icon: "today", label: "Today" },
  { to: "/library", icon: "library", label: "Library" },
  { to: "/discover", icon: "spark", label: "Discover" },
  { to: "/add", icon: "add", label: "Add" },
  { to: "/recall", icon: "recall", label: "Recall" },
  { to: "/notebook", icon: "notebook", label: "Notebook" },
  { to: "/assistant", icon: "chat", label: "Assistant" },
];

function Shell({ me, path, children }: { me: Me; path: string; children: React.ReactNode }) {
  const base = "/" + (path.split(/[/?]/)[1] || "");
  const active = (to: string) => (to === "/" ? base === "/" : base === to);
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }); location.href = "/"; };
  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="brand" aria-label="The Reading Room, home">
          <span className="brand-mark"><Icon name="book" size={17} /></span>
          <span className="brand-name">Reading<br />Room</span>
        </Link>
        {/* @ts-expect-error a custom element from carebun.com/launcher.js */}
        <carebun-apps class="side-apps" label="carebun apps"></carebun-apps>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => <Link key={n.to} to={n.to} className={active(n.to) ? "on" : ""} aria-current={active(n.to) ? "page" : undefined}><Icon name={n.icon} /><span>{n.label}</span></Link>)}
          {me.role === "admin" && <Link to="/admin" className={active("/admin") ? "on" : ""}><Icon name="admin" /><span>Admin</span></Link>}
        </nav>
        <div className="side-foot">
          <Link to="/account" className={`who ${active("/account") ? "on" : ""}`}><span className="avatar">{me.name.charAt(0).toUpperCase()}</span><span className="who-name">{me.name}<small>{me.role === "admin" ? "admin" : `@${me.username}`}</small></span></Link>
          <a className="carebun-link" href="https://carebun.com">part of carebun</a>
          <div className="side-tools"><ThemeToggle /><button className="iconbtn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="ext" /></button></div>
        </div>
      </aside>
      <main className="main" id="main">{children}</main>
      {/* @ts-expect-error a custom element from carebun.com/launcher.js */}
      <carebun-apps class="mobile-apps" label="Apps"></carebun-apps>
      <nav className="tabs" aria-label="Main">
        {NAV.filter((n) => n.to !== "/notebook" && n.to !== "/add").map((n) => <Link key={n.to} to={n.to} className={active(n.to) ? "on" : ""}><Icon name={n.icon} size={20} /><span>{n.label}</span></Link>)}
      </nav>
    </div>
  );
}

function App() {
  const path = usePath();
  const [boot, setBoot] = React.useState<Boot | null>(null);
  const load = React.useCallback(() => api<Boot>("/api/me").then(setBoot).catch(() => setBoot({ user: null, allowSignup: true, models: [], defaultModel: "" })), []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const out = () => setBoot((b) => (b ? { ...b, user: null } : b));
    window.addEventListener("lms:signedout", out);
    return () => window.removeEventListener("lms:signedout", out);
  }, []);

  if (!boot) return <div className="boot"><Spinner /></div>;
  if (!boot.user) return <BootCtx.Provider value={boot}><Login allowSignup={boot.allowSignup} onDone={load} /><Toast /></BootCtx.Provider>;

  const [p, q = ""] = path.split("?");
  const seg = p.split("/").filter(Boolean);
  let page: React.ReactNode;
  switch (seg[0]) {
    case undefined: page = <Today me={boot.user} />; break;
    case "library": page = <Library query={new URLSearchParams(q)} />; break;
    case "discover": page = seg[1] ? <DiscoverOne key={seg[1]} id={decodeURIComponent(seg[1])} /> : <Discover />; break;
    case "add": page = <Add initial={new URLSearchParams(q).get("q") || ""} />; break;
    case "read": page = <Reader key={seg[1]} id={decodeURIComponent(seg[1] || "")} />; break;
    case "recall": page = <RecallSession />; break;
    case "notebook": page = <Notebook />; break;
    case "assistant": page = <Assistant key={seg[1] || "new"} threadId={seg[1] ? decodeURIComponent(seg[1]) : undefined} />; break;
    case "admin": page = boot.user.role === "admin" ? <Admin me={boot.user} /> : <NotFound />; break;
    case "account": page = <Account me={boot.user} />; break;
    default: page = <NotFound />;
  }
  return <BootCtx.Provider value={boot}><Shell me={boot.user} path={path}>{page}</Shell><Toast /></BootCtx.Provider>;
}

function NotFound() {
  return <div className="page narrow"><h1 className="display">Nothing on this shelf.</h1><p className="lede">That page doesn’t exist. <a href="/" onClick={(e) => { e.preventDefault(); go("/"); }}>Back to today</a>.</p></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
