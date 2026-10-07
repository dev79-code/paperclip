import type { DB } from "@/lib/types";
import { isLocked, load } from "@/lib/db";
import { submit } from "@/lib/store";
import { config } from "@/lib/config";
import { tick } from "@/lib/agent/loop";
import { publicTreasury } from "@/lib/wallet/payouts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// DEMO autoplay: in demo mode the dashboard itself drives the agent, so `npm start` alone shows a
// live run. Set DEMO_AUTOPLAY=0 to disable (e.g. when running `npm run agent` separately).
const TICK_S = Number(process.env.DEMO_TICK_SECONDS || 10);
const RESTART_S = Number(process.env.DEMO_RESTART_SECONDS || 60);
let running: Promise<unknown> | null = null;

async function autoplay() {
  if (config.mode !== "demo" || process.env.DEMO_AUTOPLAY === "0" || running || isLocked()) return;
  const db = load();
  const since = (Date.now() - Date.parse(db.lastTickAt || "1970-01-01")) / 1000;
  const cur = db.items.find((i) => i.id === db.currentItemId)!;
  if (cur.estValueUsd >= db.goalUsd) {
    const doneAt = db.trades.at(-1)?.completedAt;
    if (doneAt && (Date.now() - Date.parse(doneAt)) / 1000 > RESTART_S) await submit({ type: "reset" }); // loop the showcase
    return;
  }
  if (since < TICK_S) return;
  running = tick().finally(() => (running = null));
  await running;
}

// Error lines are for the operator: strip URLs / raw API bodies and collapse repeats before showing them publicly.
function cleanError(t: string) {
  if (/openrouter|anthropic|\b(401|402|403|429)\b|key limit/i.test(t) && !/brain is offline/.test(t))
    return t.replace(/\s*(failed)?:.*$/is, "").trim() + " – the AI was unavailable, will retry.";
  return t.replace(/https?:\/\/\S+/g, "").replace(/\{[\s\S]*$/, "…").slice(0, 220);
}
function publicLog(log: DB["log"]) {
  const out: DB["log"] = [];
  for (const l of log.slice(-300)) {
    const e = l.kind === "error" ? { ...l, text: cleanError(l.text) } : l;
    const prev = out.at(-1);
    if (e.kind === "error" && prev?.kind === "error" && /AI was unavailable|brain is offline/.test(prev.text) && /AI was unavailable|brain is offline/.test(e.text)) continue;
    out.push(e);
  }
  return out.slice(-120);
}

// Public read-only state (simulator ground truth and contact details stripped).
export async function GET() {
  try {
    await autoplay();
  } catch (e) {
    console.error(e);
  }
  const db = load();
  return Response.json({
    mode: config.mode,
    goalUsd: db.goalUsd,
    tickCount: db.tickCount,
    lastTickAt: db.lastTickAt,
    currentItemId: db.currentItemId,
    items: db.items,
    trades: db.trades,
    venues: db.venues.map(({ id, name, channel, stats, permission }) => ({ id, name, channel, stats, permission })),
    offers: db.offers.slice(-150).map(({ sim, threadRef, messages, rawText, ...o }) => ({
      ...o,
      from: o.channel === "web" || o.channel === "email" ? "private" : o.from,
      postUrl: db.posts.find((p) => p.id === o.postId)?.url,
    })),
    log: publicLog(db.log),
    activity: db.activity.slice(-80),
    watchlist: db.watchlist,
    history: db.history.slice(-400),
    postsCount: db.posts.length,
    xHandle: config.xHandle,
    treasury: publicTreasury(db),
    rules: { approvalThresholdUsd: config.approvalThresholdUsd, roundMin: config.tickMinMinutes, roundMax: config.tickMaxMinutes },
    // Real posts & public replies on X (embedded on the site). Demo posts have no real id → shown as previews.
    xFeed: [
      ...db.posts.filter((p) => p.channel === "x" && /^\d{6,}$/.test(p.externalId || "")).map((p) => ({ kind: "post", id: p.externalId!, at: p.createdAt, url: p.url, text: p.title })),
      ...db.offers.filter((o) => o.channel === "x" && o.sourceUrl && /^\d{6,}$/.test(o.threadRef || "")).map((o) => ({ kind: "reply", id: o.threadRef!, at: o.createdAt, url: o.sourceUrl, text: o.itemName, from: o.from })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6),
    xPreview: db.posts.filter((p) => p.channel === "x").slice(-3).reverse().map((p) => ({ at: p.createdAt, text: p.title })),
    ...(() => {
      const auto = config.mode === "demo" && process.env.DEMO_AUTOPLAY !== "0";
      const last = Date.parse(db.lastTickAt || "") || Date.now();
      const next = auto ? new Date(last + TICK_S * 1000).toISOString() : db.nextTickAt;
      const gap = next ? Math.max(1, (Date.parse(next) - last) / 1000) : config.tickMaxMinutes * 60;
      return { nextTickAt: next, roundIntervalSec: Math.round(gap), roundRange: auto ? null : [config.tickMinMinutes, config.tickMaxMinutes] };
    })(),
  });
}
