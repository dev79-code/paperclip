// Tiny JSON-file store. Good enough for an MVP running on one box.
// For production swap this module for Supabase/Postgres (see supabase/schema.sql).
//
// Concurrency: the agent round (tick) holds the database for as long as its AI calls take. To stop a
// round's final save from overwriting changes made meanwhile (admin approvals, new web offers, email
// replies), every write goes through ONE cross-process lock (data/db.json.lock). Writers that can't get
// the lock append their change to an inbox (data/inbox.jsonl); the lock holder applies the inbox just
// before it saves. See lib/store.ts.
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

// ---------------------------------------------------------------- cross-process lock
const LOCK = FILE + ".lock";
const STALE_MS = 30 * 60_000;

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}

/** Try to take the lock once. Clears a lock left behind by a crashed process. */
export function tryLock(): boolean {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  try {
    const fd = fs.openSync(LOCK, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    try {
      const pid = Number(fs.readFileSync(LOCK, "utf8"));
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if ((pid && !pidAlive(pid)) || age > STALE_MS) {
        fs.rmSync(LOCK, { force: true });
        return tryLock();
      }
    } catch {
      /* lock vanished between checks – just report busy */
    }
    return false;
  }
}

export function unlock() {
  fs.rmSync(LOCK, { force: true });
}

export function isLocked() {
  return fs.existsSync(LOCK);
}

// ---------------------------------------------------------------- inbox of pending writes
const INBOX = path.join(path.dirname(FILE), "inbox.jsonl");

export function appendInbox(entry: object) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(INBOX, JSON.stringify(entry) + "\n");
}

/** Atomically take everything queued so far. Call `done()` after the database has been saved. */
export function takeInbox<T>(): { entries: T[]; done: () => void } {
  const dir = path.dirname(FILE);
  const files: string[] = [];
  // leftovers from a crash mid-apply come first
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (f.startsWith("inbox.jsonl.") && f.endsWith(".processing")) files.push(path.join(dir, f));
  if (fs.existsSync(INBOX)) {
    const claimed = `${INBOX}.${Date.now()}.${process.pid}.processing`;
    fs.renameSync(INBOX, claimed); // appends from now on go to a fresh inbox.jsonl
    files.push(claimed);
  }
  const entries: T[] = [];
  for (const f of files.sort())
    for (const line of fs.readFileSync(f, "utf8").split("\n"))
      if (line.trim()) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          /* skip a torn line */
        }
      }
  return { entries, done: () => files.forEach((f) => fs.rmSync(f, { force: true })) };
}

export function inboxSize() {
  try {
    return fs.readFileSync(INBOX, "utf8").split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
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

/** Replace the contents of `db` in place with a fresh paperclip start (used by the reset action). */
export function resetInPlace(db: DB) {
  const fresh = seed();
  for (const k of Object.keys(db)) delete (db as any)[k];
  Object.assign(db, fresh);
}
