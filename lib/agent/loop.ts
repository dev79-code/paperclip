// The agent loop: OUTREACH → LISTEN → EVALUATE → NEGOTIATE → (APPROVE) → TRADE → LEARN.
import { config } from "../config";
import { currentItem, log, uid } from "../db";
import { withDb } from "../store";
import type { DB, Evaluation, Item, Offer, Venue } from "../types";
import { evaluateOffer, parseIncoming, think, writePost } from "./brain";
import { channelFor, venueAllowed } from "./channels";
import { enforce, needsApproval } from "./policy";
import { act, compsUrl, recordHistory, siteOf, updateWatchlist, urlFor } from "./telemetry";

const H = 3600_000;
const fmt = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`);
const now = () => new Date().toISOString();
const OPEN: Offer["status"][] = ["new", "evaluated", "countered", "awaiting_approval", "accepted"];

/** Run one agent round. Returns the saved database, or null if another round is already running. */
export async function tick(): Promise<DB | null> {
  const r = await withDb(async (db) => {
    db.tickCount++;
    if (config.mode === "demo") simulateCounterparties(db);
    if (currentItem(db).estValueUsd >= db.goalUsd) return db; // goal reached – resting

    const item = currentItem(db);
    // One deal at a time: while a trade is pending (approval / shipping) don't solicit new offers.
    const dealPending = db.offers.some((o) => o.status === "awaiting_approval" || o.status === "accepted");
    const chosen = dealPending ? [] : chooseVenues(db, item);
    const wantTargets = !db.watchlist.some((w) => w.kind === "target" && w.status === item.id);
    let targets: Awaited<ReturnType<typeof think>>["targets"] = null;
    if (dealPending) {
      log(db, "think", `A deal is in progress, so I'm not asking for new offers until it lands.`);
    } else {
      const t = await safe(() => think(db, item, chosen, wantTargets), { thought: "(thinking failed)", targets: null });
      targets = t.targets;
      log(db, "think", t.thought);
      act(db, { site: "agent", url: "paperclip://mind", action: "think", title: "Planning this round", detail: t.thought,
        rows: (targets ?? []).map((x) => ({ label: x.name, value: fmt(x.estValueUsd), meta: "target" })) });
    }

    await outreach(db, item, chosen);
    await listen(db, item);
    await evaluateNew(db, item);
    await decide(db, currentItem(db));
    updateWatchlist(db, currentItem(db), targets);
    recordHistory(db, currentItem(db));
    return db;
  });
  return r ? r.db : null;
}

// ---------------------------------------------------------------- 1. pick where to post
function chooseVenues(db: DB, item: Item): Venue[] {
  const t = Date.now();
  // In demo mode cooldowns are compressed: 1 "hour" = 1 tick, so things move quickly.
  const elapsedH = (v: Venue) =>
    !v.lastPostedAt ? Infinity : config.mode === "demo" ? db.tickCount - Number(db.cursors[`lastTick_${v.id}`] || 0) : (t - Date.parse(v.lastPostedAt)) / H;
  const cooldown = (v: Venue) => (config.mode === "demo" ? Math.max(1, Math.round(v.cooldownHours / 48)) : v.cooldownHours);
  return db.venues
    .filter((v) => venueAllowed(v) && channelFor(v))
    .filter((v) => item.estValueUsd >= v.minValueUsd && item.estValueUsd <= v.maxValueUsd)
    .filter((v) => v.categories.includes("*") || v.categories.includes(item.category) || item.estValueUsd > 500)
    .filter((v) => elapsedH(v) >= cooldown(v))
    // learn: venues that produce more offers per post get priority (with a bonus for untried ones)
    .sort((a, b) => yieldOf(b) - yieldOf(a))
    .slice(0, config.maxPostsPerTick);
}
const yieldOf = (v: Venue) => (v.stats.posts === 0 ? 1.5 : (v.stats.offers + 2 * v.stats.accepted) / v.stats.posts);

// ---------------------------------------------------------------- 2. post trade requests
async function outreach(db: DB, item: Item, venues: Venue[]) {
  for (const v of venues) {
    try {
      const { title, body } = await writePost(db, item, v);
      act(db, { site: siteOf(v), url: urlFor(v, "compose"), action: "open", title: v.name, detail: "Opening the post composer" });
      act(db, { site: siteOf(v), url: urlFor(v, "compose"), action: "type", title, detail: body });
      const res = await channelFor(v)!.publish(v, title, body);
      db.posts.push({ id: uid("post_"), venueId: v.id, channel: v.channel, externalId: res.externalId, url: res.url, title, body, itemId: item.id, createdAt: now() });
      v.lastPostedAt = now();
      db.cursors[`lastTick_${v.id}`] = String(db.tickCount);
      v.stats.posts++;
      log(db, "post", `Posted in ${v.name}: “${title}”`, v.id);
      act(db, { site: siteOf(v), url: res.url?.replace(/^https?:\/\//, "") || urlFor(v, "compose"), action: "submit", title, detail: body });
    } catch (e: any) {
      log(db, "error", `Posting to ${v.name} failed: ${e.message}`, v.id);
    }
  }
}

// ---------------------------------------------------------------- 3. collect replies → offers
async function listen(db: DB, item: Item) {
  for (const v of db.venues.filter((v) => venueAllowed(v))) {
    const ch = channelFor(v);
    if (!ch) continue;
    try {
      const incoming = await ch.fetchReplies(db, v, db.posts);
      if (incoming.length)
        act(db, { site: siteOf(v), url: urlFor(v, "replies"), action: "scan", title: `${v.name} – replies`,
          detail: incoming.length ? `${incoming.length} new repl${incoming.length === 1 ? "y" : "ies"}` : "No new replies yet",
          rows: incoming.slice(0, 5).map((m) => ({ label: m.from, value: m.text.slice(0, 90) })) });
      for (const msg of incoming) {
        const existing = db.offers.find((o) => o.threadRef === msg.threadRef && o.from === msg.from && OPEN.includes(o.status));
        if (existing) {
          existing.messages.push({ role: "them", text: msg.text, at: now() });
          existing.photos.push(...msg.photos);
          existing.status = "new"; // re-evaluate with the new info
          continue;
        }
        const parsed = await parseIncoming(msg, item);
        if (!parsed.isOffer) continue;
        const offer: Offer = {
          id: uid("off_"),
          channel: msg.channel,
          venueId: v.id,
          postId: msg.postId,
          from: msg.from,
          threadRef: msg.threadRef,
          rawText: msg.text,
          itemName: parsed.itemName,
          itemDescription: parsed.itemDescription,
          photos: msg.photos,
          createdAt: now(),
          status: "new",
          messages: [{ role: "them", text: msg.text, at: now() }],
          sim: msg.demo,
        };
        db.offers.push(offer);
        v.stats.offers++;
        log(db, "offer", `${msg.from} (${v.name}) offers: ${parsed.itemName}`, offer.id);
      }
    } catch (e: any) {
      log(db, "error", `Reading replies from ${v.name} failed: ${e.message}`, v.id);
    }
  }
}

// ---------------------------------------------------------------- 4. value every new offer
async function evaluateNew(db: DB, item: Item) {
  for (const o of db.offers.filter((o) => o.status === "new")) {
    try {
      act(db, { site: "ebay", url: compsUrl(o.itemName), action: "search", title: o.itemName, detail: `Checking what “${o.itemName}” really sells for` });
      const ev = enforce(await evaluateOffer(db, item, o, o.sim), item);
      act(db, { site: "ebay", url: compsUrl(o.itemName), action: "read", title: o.itemName,
        detail: `${ev.decision.toUpperCase()} · ${(ev.estValueUsd / item.estValueUsd).toFixed(2)}x · ${ev.reasoning}`,
        rows: [
          { label: "Low estimate", value: fmt(ev.valueLow) },
          { label: "Estimated value", value: fmt(ev.estValueUsd), meta: "best guess" },
          { label: "High estimate", value: fmt(ev.valueHigh) },
          ...ev.policyFlags.map((f) => ({ label: "Flag: " + f, meta: "flag" })),
        ] });
      o.evaluation = ev;
      o.updatedTick = db.tickCount;
      const mult = ev.estValueUsd / item.estValueUsd;
      log(db, "evaluate", `${o.itemName}: ~${fmt(ev.estValueUsd)} (${mult.toFixed(2)}x) → ${ev.decision.toUpperCase()}. ${ev.reasoning}`, o.id);
      if (ev.policyFlags.length) log(db, "policy", `Flags on “${o.itemName}”: ${ev.policyFlags.join(", ")}`, o.id);
      if (ev.decision === "reject") {
        await say(db, o, ev.replyText);
        o.status = "rejected";
      } else if (ev.decision === "counter") {
        await say(db, o, ev.replyText);
        o.status = "countered";
      } else {
        o.status = "evaluated"; // accept-worthy; decide() picks the best one
      }
    } catch (e: any) {
      log(db, "error", `Evaluating ${o.itemName} failed: ${e.message}`, o.id);
    }
  }
}

// ---------------------------------------------------------------- 5. pick the best deal
async function decide(db: DB, item: Item) {
  if (db.offers.some((o) => o.status === "awaiting_approval" || o.status === "accepted")) return; // one deal at a time
  const best = db.offers
    .filter((o) => o.status === "evaluated" && o.evaluation?.decision === "accept")
    .sort((a, b) => b.evaluation!.score - a.evaluation!.score)[0];
  if (!best) return;
  if (needsApproval(best.evaluation!)) {
    best.status = "awaiting_approval";
    best.updatedTick = db.tickCount;
    log(db, "policy", `“${best.itemName}” (~${fmt(best.evaluation!.estValueUsd)}) is above the approval threshold – waiting for a human in /admin.`, best.id);
    return;
  }
  await acceptOffer(db, best);
}

export async function acceptOffer(db: DB, o: Offer) {
  o.status = "accepted";
  o.updatedTick = db.tickCount;
  await say(db, o, o.evaluation?.replyText || "Deal! A human will be in touch about shipping.");
  log(db, "think", `Accepted ${o.from}'s ${o.itemName}. Waiting for the item to arrive and be checked.`, o.id);
}

/** Called when the human custodian confirms the item arrived as described (or auto in demo). */
export function completeTrade(db: DB, o: Offer) {
  const from = currentItem(db);
  const ev = o.evaluation!;
  const item: Item = {
    id: uid("item_"),
    name: o.itemName,
    description: o.itemDescription,
    category: ev.category,
    estValueUsd: ev.estValueUsd,
    valueLow: ev.valueLow,
    valueHigh: ev.valueHigh,
    valuationNotes: ev.reasoning,
    marketNotes: ev.marketNotes,
    imageUrl: o.photos[0],
    acquiredAt: now(),
    acquiredFrom: o.from,
  };
  db.items.push(item);
  const number = db.trades.length + 1;
  const multiplier = +(item.estValueUsd / from.estValueUsd).toFixed(2);
  db.trades.push({ id: uid("tr_"), number, fromItemId: from.id, toItemId: item.id, offerId: o.id, counterparty: o.from, channel: o.channel, multiplier, rationale: ev.reasoning, completedAt: now() });
  db.currentItemId = item.id;
  o.status = "completed";
  const v = db.venues.find((v) => v.id === o.venueId);
  if (v) v.stats.accepted++;
  // Simulated offers lapse; real people's offers get re-valued against the new item next round.
  for (const other of db.offers)
    if (other.id !== o.id && OPEN.includes(other.status)) other.status = other.sim ? "expired" : "new";
  log(db, "trade", `TRADE #${number}: ${from.name} → ${item.name} (~${fmt(item.estValueUsd)}, ${multiplier}x) with ${o.from}`, item.id);
  if (item.estValueUsd >= db.goalUsd) log(db, "system", `Goal reached in ${number} trades: ${item.name} (~${fmt(item.estValueUsd)}).`);
}

// ---------------------------------------------------------------- demo: simulate the humans
function simulateCounterparties(db: DB) {
  for (const o of db.offers) {
    if (o.updatedTick === db.tickCount) continue;
    if (o.status === "accepted" && o.sim) completeTrade(db, o); // item "arrived"
    else if (o.status === "awaiting_approval" && o.sim && process.env.DEMO_AUTO_APPROVE !== "0") {
      log(db, "system", `(demo) Human custodian approved “${o.itemName}”.`, o.id);
      o.status = "accepted";
      o.updatedTick = db.tickCount;
    } else if (o.status === "countered" && o.sim) {
      if (Math.random() < 0.5) {
        const extra = ["a vintage lens", "a signed poster", "a tool kit", "a pair of concert tickets", "a mechanical keyboard"][Math.floor(Math.random() * 5)];
        o.sim = { ...o.sim, value: +(o.sim.value * 1.4).toFixed(2), name: `${o.sim.name} + ${extra}`, story: Math.min(1, o.sim.story + 0.1) };
        o.itemName = o.sim.name;
        o.itemDescription += ` Sweetened with ${extra}.`;
        o.messages.push({ role: "them", text: `Fine – I'll throw in ${extra}!`, at: now() });
        o.status = "new";
        log(db, "offer", `${o.from} sweetened their offer: ${o.itemName}`, o.id);
      } else {
        o.status = "expired";
      }
    }
  }
}

// ---------------------------------------------------------------- helpers
async function say(db: DB, o: Offer, text: string) {
  o.messages.push({ role: "agent", text, at: now() });
  const v = db.venues.find((v) => v.id === o.venueId);
  try {
    act(db, { site: siteOf(v), url: v ? urlFor(v, "replies") : "paperclip.local/offers", action: "type", title: `Reply to ${o.from}`, detail: text, rows: [{ label: o.from, value: o.itemName }] });
    if (v && o.threadRef && o.channel !== "web") await channelFor(v)?.reply(o.threadRef, text, v);
    log(db, "reply", `→ ${o.from}: ${text}`, o.id);
  } catch (e: any) {
    log(db, "error", `Reply to ${o.from} failed: ${e.message}`, o.id);
  }
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    console.error(e);
    return fallback;
  }
}

export type { Evaluation };
