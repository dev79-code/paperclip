// Tiny JSON-file store. Good enough for an MVP running on one box.
// For production swap this module for Supabase/Postgres (see supabase/schema.sql) –
// every other module only talks to load()/save()/mutate().
import fs from "node:fs";
import path from "node:path";
import type { DB, LogEvent, LogKind } from "./types";
import { seed } from "./seed";

const FILE = process.env.DB_FILE || path.join(process.cwd(), "data", "db.json");

export function load(): DB {
  if (!fs.existsSync(FILE)) {
    const fresh = seed();
    save(fresh);
    return fresh;
  }
  const db = JSON.parse(fs.readFileSync(FILE, "utf8")) as DB;
  // backfill fields added after first release
  db.activity ??= [];
  db.watchlist ??= [];
  db.history ??= [];
  return db;
}

export function save(db: DB) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Load, mutate, save atomically (single process). */
export async function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const db = load();
  const out = await fn(db);
  save(db);
  return out;
}

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function log(db: DB, kind: LogKind, text: string, ref?: string): LogEvent {
  const ev = { id: uid("ev_"), at: new Date().toISOString(), kind, text, ref };
  db.log.push(ev);
  if (db.log.length > 2000) db.log.splice(0, db.log.length - 2000);
  // mirror to stdout for the worker
  console.log(`[${kind}] ${text}`);
  return ev;
}

export function currentItem(db: DB) {
  const it = db.items.find((i) => i.id === db.currentItemId);
  if (!it) throw new Error("current item missing");
  return it;
}

export function resetDb() {
  const fresh = seed();
  save(fresh);
  return fresh;
}
