/**
 * blobs — article bodies. They are large (tens of KB of HTML each), so they live in a
 * GCS bucket (LMS_BUCKET) and TwinDB keeps only the small, searchable metadata. On
 * Cloud Run the token comes from the metadata server; on a laptop from `gcloud`.
 * Without a bucket, bodies are files under .data/blobs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BUCKET = process.env.LMS_BUCKET || "";
const LOCAL = join(process.cwd(), ".data/blobs");

let tok: { value: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (tok && tok.exp > Date.now()) return tok.value;
  try {
    const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(1500),
    });
    if (r.ok) {
      const j = (await r.json()) as { access_token: string; expires_in: number };
      tok = { value: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
      return tok.value;
    }
  } catch { /* not on GCP */ }
  const p = Bun.spawnSync(["gcloud", "auth", "print-access-token"]);
  const value = p.stdout.toString().trim();
  if (!value) throw new Error("no GCS credentials");
  tok = { value, exp: Date.now() + 45 * 60_000 };
  return value;
}

export async function putBlob(name: string, body: unknown): Promise<void> {
  const data = JSON.stringify(body);
  if (!BUCKET) {
    const p = join(LOCAL, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    return;
  }
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" }, body: data,
  });
  if (!r.ok) throw new Error(`gcs put ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export async function getBlob<T>(name: string): Promise<T | null> {
  if (!BUCKET) {
    const p = join(LOCAL, name);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
  }
  const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media`, {
    headers: { authorization: `Bearer ${await token()}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`gcs get ${r.status}`);
  return (await r.json()) as T;
}
