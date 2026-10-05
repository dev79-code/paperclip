// Records what the agent is doing so the dashboard can replay it as a "live browser" view,
// keeps the watchlist (open offers + targets it is hunting) and the value history.
import { config } from "../config";
import { uid } from "../db";
import type { Activity, DB, Item, Site, Venue } from "../types";

export function act(db: DB, a: Omit<Activity, "id" | "at">) {
  db.activity.push({ id: uid("act_"), at: new Date().toISOString(), ...a });
  if (db.activity.length > 300) db.activity.splice(0, db.activity.length - 300);
}

export function siteOf(v?: Venue): Site {
  if (!v) return "web";
  return v.channel === "discourse" ? "forum" : v.channel === "demo" || v.channel === "web" ? "web" : v.channel;
}

export function urlFor(v: Venue, kind: "compose" | "replies"): string {
  switch (v.channel) {
    case "reddit":
      return kind === "compose" ? `reddit.com/r/${v.target}/submit` : `reddit.com/r/${v.target}/comments/new`;
    case "x":
      return kind === "compose" ? "x.com/compose/post" : "x.com/notifications/mentions";
    case "discourse": {
      const base = v.target.split("|")[0].replace(/^https?:\/\//, "");
      return kind === "compose" ? `${base}/new-topic` : `${base}/latest`;
    }
    case "email":
      return kind === "compose" ? "mail/compose" : "mail/inbox";
    default:
      return "paperclip.local";
  }
}

export const compsUrl = (q: string) => `ebay.com/sch/i.html?_nkw=${encodeURIComponent(q).replace(/%20/g, "+")}&LH_Sold=1`;

// ---------------------------------------------------------------- watchlist
export function updateWatchlist(db: DB, item: Item, targets: { name: string; category: string; estValueUsd: number }[] | null) {
  const cur = item.estValueUsd;
  const jitter = () => (config.mode === "demo" ? 1 + (Math.random() - 0.5) * 0.06 : 1);
  const keep = new Map(db.watchlist.map((w) => [w.id, w]));
  const next: typeof db.watchlist = [];

  // 1) open offers worth tracking
  for (const o of db.offers) {
    if (!["evaluated", "countered", "awaiting_approval", "accepted"].includes(o.status) || !o.evaluation) continue;
    const id = "w_" + o.id;
    const prev = keep.get(id);
    const v = o.evaluation.estValueUsd * (prev ? jitter() : 1);
    next.push({
      id, name: o.itemName, category: o.evaluation.category, kind: "offer", from: o.from, offerId: o.id, status: o.status,
      estValueUsd: +v.toFixed(2), multiplier: +(v / cur).toFixed(2),
      history: [...(prev?.history ?? []), +v.toFixed(2)].slice(-24), firstSeenTick: prev?.firstSeenTick ?? db.tickCount,
    });
  }

  // 2) targets – things the agent wants to trade into next (replaced when it gets a new item)
  const oldTargets = db.watchlist.filter((w) => w.kind === "target" && w.status === item.id);
  const tg = targets ?? oldTargets.map((t) => ({ name: t.name, category: t.category, estValueUsd: t.estValueUsd }));
  const offered = new Set(next.map((w) => w.name.toLowerCase()));
  for (const t of tg.filter((t) => !offered.has(t.name.toLowerCase())).slice(0, 4)) {
    const id = "t_" + item.id + "_" + t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const prev = keep.get(id);
    const v = (prev ? prev.estValueUsd : t.estValueUsd) * (prev ? jitter() : 1);
    next.push({
      id, name: t.name, category: t.category, kind: "target", status: item.id,
      estValueUsd: +v.toFixed(2), multiplier: +(v / cur).toFixed(2),
      history: [...(prev?.history ?? []), +v.toFixed(2)].slice(-24), firstSeenTick: prev?.firstSeenTick ?? db.tickCount,
    });
  }
  db.watchlist = next.sort((a, b) => b.multiplier - a.multiplier);
}

export function recordHistory(db: DB, item: Item) {
  db.history.push({ tick: db.tickCount, at: new Date().toISOString(), value: item.estValueUsd });
  if (db.history.length > 1000) db.history.splice(0, db.history.length - 1000);
  db.lastTickAt = new Date().toISOString();
}
