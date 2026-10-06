// The only way to WRITE the database. Combines the cross-process lock with the inbox so nothing is lost:
//
//   withDb(fn)    – take the lock, load, run fn, apply any queued actions, save, release.
//                   Used by the agent round (which may hold it for minutes while the AI thinks).
//   submit(a)     – queue an action, then try briefly to apply it straight away. If an agent round is
//                   running, the action stays queued and that round applies it right before saving.
import { appendInbox, load, log, save, takeInbox, tryLock, uid, unlock } from "./db";
import type { DB } from "./types";
import { applyAction, type Action, type QueuedAction } from "./actions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drainInbox(db: DB): Promise<{ results: Map<string, string>; done: () => void }> {
  const { entries, done } = takeInbox<QueuedAction>();
  const results = new Map<string, string>();
  for (const a of entries) {
    let r: string;
    try {
      r = await applyAction(db, a);
    } catch (e: any) {
      r = e.message || "failed";
    }
    results.set(a.id, r);
    if (r !== "ok") log(db, "error", `Queued ${a.type} action could not be applied: ${r}`);
  }
  return { results, done };
}

/** Run `fn` with exclusive access to the database. Returns null if the lock wasn't free within `waitMs`. */
export async function withDb<T>(fn: (db: DB) => T | Promise<T>, waitMs = 0): Promise<{ value: T; db: DB; results: Map<string, string> } | null> {
  const until = Date.now() + waitMs;
  while (!tryLock()) {
    if (Date.now() >= until) return null;
    await sleep(100);
  }
  try {
    const db = load();
    const value = await fn(db);
    const { results, done } = await drainInbox(db); // changes that arrived while fn was running
    save(db);
    done();
    return { value, db, results };
  } finally {
    unlock();
  }
}

/** Queue a change and apply it now if the database is free (otherwise the running round applies it). */
export async function submit(a: Action): Promise<{ applied: true; result: string } | { applied: false; queued: true }> {
  const id = uid("q_");
  appendInbox({ ...a, id, at: new Date().toISOString() });
  const r = await withDb(() => undefined, 1500);
  if (!r) return { applied: false, queued: true };
  return { applied: true, result: r.results.get(id) ?? "ok" };
}
