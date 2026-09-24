/**
 * auth — a username and a password (scrypt), a signed cookie, two roles.
 * An admin can reset anyone's password and promote or demote accounts. The first
 * admin is seeded from ADMIN_USERNAME / ADMIN_PASSWORD at startup.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { C, findAll, get, put } from "./db";

export const COOKIE = "lms_session";
const MAX_AGE = 60 * 60 * 24 * 90;

export type Role = "admin" | "learner";
export interface User { _id: string; username: string; name?: string; salt: string; hash: string; role: Role; created: number; lastLogin: number; resetAt?: number }
export interface Session { username: string; role: Role; name: string }

export const normalize = (u: string) => u.trim().toLowerCase();
export const validUsername = (u: string) => /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(u);
const hashPw = (pw: string, salt: string) => scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
const secret = () => process.env.SESSION_SECRET || "dev-only-secret-change-me";

function sign(username: string, issued: string, stamp: string) {
  return createHmac("sha256", secret()).update(`${username}.${issued}.${stamp}`).digest("hex").slice(0, 32);
}

/** a signed session value; the same for the browser cookie and the extension's bearer token */
export function sessionToken(u: User): string {
  const issued = String(Date.now()), stamp = String(u.resetAt || 0);
  return `${u.username}.${issued}.${stamp}.${sign(u.username, issued, stamp)}`;
}

/** the cookie carries the password's reset stamp, so a reset signs every browser (and extension) out */
export function sessionCookie(u: User): string {
  const value = sessionToken(u);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const cache = new Map<string, { at: number; user: User | null }>();
async function loadUser(username: string): Promise<User | null> {
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < 30_000) return hit.user;
  const user = await get<User>(C.user, username);
  cache.set(username, { at: Date.now(), user });
  return user;
}
const forget = (username: string) => cache.delete(username);

export async function session(req: Request): Promise<Session | null> {
  // the browser sends the cookie; the Chrome extension sends the same value as a bearer token
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/)?.[1];
  const raw = bearer || req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [username, issued, stamp, mac] = raw.split(".");
  if (!username || !issued || !mac || !validUsername(username)) return null;
  if (Date.now() - Number(issued) > MAX_AGE * 1000) return null;
  const want = sign(username, issued, stamp);
  if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  const user = await loadUser(username);
  if (!user || String(user.resetAt || 0) !== stamp) return null;
  return { username, role: user.role, name: user.name || username };
}

export type AuthResult = { ok: true; user: User } | { ok: false; error: string };

export async function login(rawUsername: string, password: string): Promise<AuthResult> {
  const username = normalize(rawUsername);
  const u = await get<User>(C.user, username);
  if (!u) return { ok: false, error: "No account with that username." };
  const a = Buffer.from(hashPw(password, u.salt), "hex"), b = Buffer.from(u.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "That password is not right." };
  const next = { ...u, lastLogin: Date.now() };
  await put(C.user, next as unknown as Record<string, unknown>, username);
  forget(username);
  return { ok: true, user: next };
}

export async function signup(rawUsername: string, password: string, name = "", role: Role = "learner"): Promise<AuthResult> {
  const username = normalize(rawUsername);
  if (!validUsername(username)) return { ok: false, error: "Usernames are 3–32 letters, digits, dot, dash or underscore." };
  if (password.length < 6) return { ok: false, error: "Use at least 6 characters for the password." };
  if (await get(C.user, username)) return { ok: false, error: "That username is taken." };
  const salt = randomBytes(16).toString("hex");
  const u: User = { _id: username, username, name: name.trim().slice(0, 60) || undefined, salt, hash: hashPw(password, salt), role, created: Date.now(), lastLogin: Date.now() };
  await put(C.user, u as unknown as Record<string, unknown>, username);
  forget(username);
  return { ok: true, user: u };
}

export async function setPassword(username: string, password: string): Promise<boolean> {
  const u = await get<User>(C.user, normalize(username));
  if (!u || password.length < 6) return false;
  const salt = randomBytes(16).toString("hex");
  await put(C.user, { ...u, salt, hash: hashPw(password, salt), resetAt: Date.now() } as unknown as Record<string, unknown>, u._id);
  forget(u._id);
  return true;
}

export async function setRole(username: string, role: Role): Promise<boolean> {
  const u = await get<User>(C.user, normalize(username));
  if (!u) return false;
  await put(C.user, { ...u, role } as unknown as Record<string, unknown>, u._id);
  forget(u._id);
  return true;
}

export async function listUsers() {
  const users = await findAll<User>(C.user, { sort: "-lastLogin" });
  return users.map(({ salt: _s, hash: _h, ...u }) => u);
}

/**
 * ADMIN_USERNAME/ADMIN_PASSWORD create the first admin; an existing account named there is promoted.
 * When ADMIN_PASSWORD itself changes (in .env or the secret), the new one is applied once; a password
 * changed later in the app is left alone until ADMIN_PASSWORD changes again.
 */
export async function seedAdmin(): Promise<void> {
  const name = normalize(process.env.ADMIN_USERNAME || "");
  const pw = process.env.ADMIN_PASSWORD || "";
  if (!name) return;
  const seed = pw ? createHmac("sha256", secret()).update(`seed.${pw}`).digest("hex").slice(0, 24) : "";
  let u = await get<User & { seed?: string }>(C.user, name);
  if (!u && pw) { await signup(name, pw, process.env.ADMIN_NAME || name.charAt(0).toUpperCase() + name.slice(1), "admin"); console.log(`[auth] seeded admin ${name}`); }
  else if (u && pw && u.seed !== seed) { await setPassword(name, pw); console.log(`[auth] ADMIN_PASSWORD changed; applied to ${name}`); }
  u = await get<User & { seed?: string }>(C.user, name);
  if (u && (u.role !== "admin" || (pw && u.seed !== seed))) {
    await put(C.user, { ...u, role: "admin", ...(pw ? { seed } : {}) } as unknown as Record<string, unknown>, name);
    forget(name);
  }
}

export const tempPassword = () => randomBytes(6).toString("base64url");
