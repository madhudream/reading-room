import React from "react";
import { api, ago, go, md, streamChat } from "../api";
import { BootCtx, Icon, Link, Spinner, toast, useAsync } from "../ui";

interface Turn { role: "user" | "assistant"; content: string; at?: number }
interface ChatRow { _id: string; title: string; itemId?: string; updated: number; n: number }

export function ChatPanel({ threadId: initialThread, itemId, compact, seed, suggestions, onThread }: {
  threadId?: string; itemId?: string; compact?: boolean; seed?: { text: string; n: number } | null;
  suggestions?: string[]; onThread?: (id: string) => void;
}) {
  const boot = React.useContext(BootCtx);
  const [thread, setThread] = React.useState<string | undefined>(initialThread);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [quote, setQuote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(!!initialThread);
  const [model, setModel] = React.useState(() => { try { return localStorage.getItem("model") || boot.defaultModel; } catch { return boot.defaultModel; } });
  const scroller = React.useRef<HTMLDivElement>(null);
  const abort = React.useRef<AbortController | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!initialThread) return;
    api<{ chat: { messages: Turn[]; model?: string } }>(`/api/chats/${encodeURIComponent(initialThread)}`)
      .then((r) => { setTurns(r.chat.messages); if (r.chat.model) setModel(r.chat.model); })
      .catch((e) => toast(e.message, "err")).finally(() => setLoading(false));
  }, [initialThread]);
  React.useEffect(() => { if (seed?.text) { setQuote(seed.text); inputRef.current?.focus(); } }, [seed?.n]);
  React.useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [turns]);

  const send = async (text = input) => {
    const msg = text.trim();
    if (!msg || busy) return;
    const shown = quote ? `> ${quote.replace(/\n/g, "\n> ")}\n\n${msg}` : msg;
    setTurns((t) => [...t, { role: "user", content: shown }, { role: "assistant", content: "" }]);
    setInput(""); setBusy(true);
    const sel = quote; setQuote(null);
    abort.current = new AbortController();
    try {
      const id = await streamChat({ threadId: thread, itemId, model, message: msg, selection: sel || undefined },
        (chunk) => setTurns((t) => { const c = [...t]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + chunk }; return c; }), abort.current.signal);
      if (id && !thread) { setThread(id); onThread?.(id); }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setTurns((t) => { const c = [...t]; c[c.length - 1] = { role: "assistant", content: `_${(e as Error).message}_` }; return c; });
    } finally { setBusy(false); abort.current = null; }
  };
  const pickModel = (m: string) => { setModel(m); try { localStorage.setItem("model", m); } catch { /* ignore */ } };

  return (
    <div className={`chat ${compact ? "compact" : ""}`}>
      <div className="chat-scroll" ref={scroller} aria-live="polite">
        {loading ? <Spinner /> : turns.length === 0 ? (
          <div className="chat-empty">
            {!compact && <><h2 className="display">Ask anything.</h2><p className="muted">About what you’ve read, what to read next, or any topic at all. The assistant knows your shelves and your recall notes.</p></>}
            {compact && <p className="muted">Ask about this article. Select any passage in the text to ask about it.</p>}
            <div className="chips col">{(suggestions || []).map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        ) : turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>
            {t.role === "assistant" ? (t.content ? <div className="md" dangerouslySetInnerHTML={{ __html: md(t.content) }} /> : <Spinner />) : <div className="md" dangerouslySetInnerHTML={{ __html: md(t.content) }} />}
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {quote && <div className="quote"><span>“{quote.slice(0, 220)}{quote.length > 220 ? "…" : ""}”</span><button type="button" className="iconbtn" onClick={() => setQuote(null)} aria-label="Remove quote"><Icon name="x" size={14} /></button></div>}
        <textarea ref={inputRef} aria-label="Message the assistant" rows={compact ? 2 : 3} value={input} onChange={(e) => setInput(e.target.value)} placeholder={quote ? "What do you want to know about this passage?" : "Message the reading assistant…"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div className="chat-tools">
          <select aria-label="Model" value={model} onChange={(e) => pickModel(e.target.value)}>{boot.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          {busy ? <button type="button" className="btn ghost sm" onClick={() => abort.current?.abort()}>Stop</button>
            : <button className="btn primary sm" disabled={!input.trim()} aria-label="Send"><Icon name="send" size={15} /></button>}
        </div>
      </form>
    </div>
  );
}

export function Assistant({ threadId }: { threadId?: string }) {
  const chats = useAsync(() => api<{ chats: ChatRow[] }>("/api/chats"), []);
  const [open, setOpen] = React.useState(false);
  const del = async (id: string) => {
    if (!confirm("Delete this conversation?")) return;
    await api(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (id === threadId) go("/assistant"); else chats.reload();
  };
  return (
    <div className="assistant-page">
      <aside className={`threads ${open ? "open" : ""}`}>
        <Link to="/assistant" className="btn primary wide" onClick={() => setOpen(false)}><Icon name="plus" size={16} /> New conversation</Link>
        <ul>
          {(chats.data?.chats || []).map((c) => (
            <li key={c._id} className={c._id === threadId ? "on" : ""}>
              <Link to={`/assistant/${encodeURIComponent(c._id)}`} onClick={() => setOpen(false)}><span className="t-title">{c.itemId && <Icon name="book" size={13} />} {c.title}</span><span className="t-meta">{ago(c.updated)}</span></Link>
              <button className="iconbtn" onClick={() => del(c._id)} aria-label="Delete conversation"><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
        {chats.data && !chats.data.chats.length && <p className="muted small">Conversations are saved here.</p>}
      </aside>
      <section className="assistant-main">
        <button className="btn ghost sm threads-toggle" onClick={() => setOpen(!open)}><Icon name="menu" size={15} /> Conversations</button>
        <ChatPanel threadId={threadId} onThread={(id) => { history.replaceState(null, "", `/assistant/${encodeURIComponent(id)}`); chats.reload(); }}
          suggestions={["What should I read next from my list, and why?", "Quiz me on something I read this week", "Explain attention in transformers like I’m new to it", "Summarise what I’ve learned so far"]} />
      </section>
    </div>
  );
}
