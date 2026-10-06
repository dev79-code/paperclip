import { isLocked, load } from "@/lib/db";
import { submit } from "@/lib/store";
import { config } from "@/lib/config";
import { tick } from "@/lib/agent/loop";
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
    offers: db.offers.slice(-150).map(({ sim, threadRef, messages, rawText, ...o }) => ({ ...o, from: o.channel === "web" || o.channel === "email" ? "private" : o.from })),
    log: db.log.slice(-120),
    activity: db.activity.slice(-80),
    watchlist: db.watchlist,
    history: db.history.slice(-400),
    postsCount: db.posts.length,
    xHandle: config.xHandle,
  });
}
