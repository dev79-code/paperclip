// X OAuth 2.0 token storage + auto-refresh. Tokens live in data/x-token.json (created by `npm run x:login`).
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "x-token.json");
interface Tok { access_token: string; refresh_token?: string; expires_at: number; user_id?: string }

export function loadTok(): Tok | null {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  // On a server: seed from env once (printed by `npm run x:login`); the rotated token is then saved to data/.
  if (process.env.X_REFRESH_TOKEN) return { access_token: "", refresh_token: process.env.X_REFRESH_TOKEN, expires_at: 0, user_id: process.env.X_USER_ID };
  return null;
}
export function saveTok(t: Tok) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(t, null, 2));
}

function basic(): Record<string, string> {
  const id = process.env.X_CLIENT_ID || "", secret = process.env.X_CLIENT_SECRET || "";
  return secret ? { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") } : {};
}

export async function tokenRequest(params: Record<string, string>): Promise<Tok> {
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...basic() },
    body: new URLSearchParams({ client_id: process.env.X_CLIENT_ID || "", ...params }),
  });
  if (!res.ok) throw new Error(`X token ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 120) * 1000 };
}

/** Current access token: static X_USER_TOKEN if set, otherwise the stored one (refreshed when expiring). */
export async function xAccessToken(): Promise<string> {
  if (process.env.X_USER_TOKEN) return process.env.X_USER_TOKEN;
  const t = loadTok();
  if (!t) throw new Error("X not logged in – run `npm run x:login`");
  if (Date.now() < t.expires_at || !t.refresh_token) return t.access_token;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  saveTok({ ...fresh, user_id: t.user_id, refresh_token: fresh.refresh_token ?? t.refresh_token });
  return fresh.access_token;
}

export function xUserId() {
  return process.env.X_USER_ID || loadTok()?.user_id || "";
}
