// TwinDB client — the same file bigImmigrationHub runs on, copied from
// /Users/bhairava/apps/twindb/clients/ts/twindb.ts. No dependencies, fetch-based.
// TwinDB client for web / Node (no dependencies, fetch-based). Copy this file into your app.
//
//   const db = new TwinDB("https://db.example.com", token);
//   const { id, txn } = await db.insert("posts", { title: "hello", user_id: "u1", created: Date.now() });
//   const post = await db.get<Post>("posts", id);
//   const { hits } = await db.find<Post>("posts", { filter: { user_id: "u1" }, sort: "-created", limit: 20, min_txn: txn });
//   await db.update("posts", id, { ...post, title: "edited" });
//   await db.remove("posts", id);
//
// Read-your-writes: every write returns `txn`; pass the latest one as `min_txn` to `find` and the search
// waits (up to `wait_ms`, default 2 s) until the index includes it. `get` always sees the latest write.

export type Durability = "none" | "local" | "bucket";

export interface FindRequest {
  filter?: Record<string, unknown>;
  q?: string;
  sort?: string | Record<string, 1 | -1>;
  limit?: number;
  offset?: number;
  count?: boolean;
  min_txn?: number;
  wait_ms?: number;
  /** Elasticsearch-shaped aggregations, e.g. { by_kind: { terms: { field: "kind" } } }; use limit: 0 for aggs only */
  aggs?: Record<string, unknown>;
}

export interface FindResult<T> {
  hits: T[];
  total?: number;
  aggs?: Record<string, unknown>;
  took_us: number;
}

export interface WriteResult {
  id: string;
  txn: number;
}

export class TwinDBError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class TwinDB {
  /** the highest txn this client has written; used automatically as min_txn when `readYourWrites` is on */
  lastTxn = 0;

  constructor(
    private base: string,
    private token?: string,
    private opts: { readYourWrites?: boolean; durable?: Durability; fetch?: typeof fetch; readFrom?: string } = {},
  ) {
    this.base = base.replace(/\/+$/, "");
    if (opts.readFrom) this.readBase = opts.readFrom.replace(/\/+$/, "");
  }

  /** optional read replica (a `--follower` node): GET and find go there, writes always go to `base` */
  private readBase?: string;

  private async call<T>(method: string, path: string, body?: unknown, idemKey?: string, read = false): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (idemKey) headers["idempotency-key"] = idemKey;
    const base = read && this.readBase ? this.readBase : this.base;
    const res = await f(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {}
      throw new TwinDBError(res.status, msg);
    }
    return (await res.json()) as T;
  }

  private q(): string {
    return this.opts.durable ? `?durable=${this.opts.durable}` : "";
  }

  private track<R extends { txn: number }>(r: R): R {
    if (r.txn > this.lastTxn) this.lastTxn = r.txn;
    return r;
  }

  /** `idemKey`: a unique key per logical write; a retry with the same key replays the original result */
  insert(col: string, doc: Record<string, unknown>, idemKey?: string): Promise<WriteResult & { replayed?: boolean }> {
    return this.call<WriteResult & { replayed?: boolean }>("POST", `/v1/${col}${this.q()}`, doc, idemKey).then((r) => this.track(r));
  }

  /** a random idempotency key for a new logical write (keep it for retries) */
  static newKey(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  insertMany(col: string, docs: Record<string, unknown>[]): Promise<{ ids: string[]; txn: number }> {
    return this.call<{ ids: string[]; txn: number }>("POST", `/v1/${col}${this.q()}`, docs).then((r) => this.track(r));
  }

  update(col: string, id: string, doc: Record<string, unknown>, idemKey?: string): Promise<WriteResult> {
    return this.call<WriteResult>("PUT", `/v1/${col}/${encodeURIComponent(id)}${this.q()}`, doc, idemKey).then((r) => this.track(r));
  }

  remove(col: string, id: string): Promise<WriteResult> {
    return this.call<WriteResult>("DELETE", `/v1/${col}/${encodeURIComponent(id)}${this.q()}`).then((r) => this.track(r));
  }

  async get<T = Record<string, unknown>>(col: string, id: string): Promise<T | null> {
    try {
      return await this.call<T>("GET", `/v1/${col}/${encodeURIComponent(id)}`, undefined, undefined, true);
    } catch (e) {
      if (e instanceof TwinDBError && e.status === 404) return null;
      throw e;
    }
  }

  find<T = Record<string, unknown>>(col: string, req: FindRequest = {}): Promise<FindResult<T>> {
    const body = { ...req };
    if (this.opts.readYourWrites !== false && body.min_txn === undefined && this.lastTxn > 0) body.min_txn = this.lastTxn;
    return this.call<FindResult<T>>("POST", `/v1/${col}/_find`, body, undefined, true);
  }

  count(col: string): Promise<number> {
    return this.call<{ count: number }>("GET", `/v1/${col}/_count`).then((r) => r.count);
  }

  /** one atomic transaction of puts and deletes across collections */
  batch(ops: ({ op: "put"; col: string; id?: string; doc: Record<string, unknown> } | { op: "delete"; col: string; id: string })[]) {
    return this.call<{ ids: string[]; txn: number }>("POST", `/v1/_batch${this.q()}`, ops).then((r) => this.track(r));
  }

  /** force-merge the index and compact the store (the server needs --admin) — after a bulk load */
  compact(): Promise<{ index_segments: number; ms: number }> {
    return this.call<{ index_segments: number; ms: number }>("POST", "/v1/_admin/compact");
  }

  status(): Promise<Record<string, unknown>> {
    return this.call("GET", "/v1/_status");
  }
}
