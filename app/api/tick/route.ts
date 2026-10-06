import { isAdmin, deny } from "@/lib/admin";
import { tick } from "@/lib/agent/loop";
export const runtime = "nodejs";
export const maxDuration = 300;

// Trigger one agent round (used by the "Run one round now" button). The long-running worker
// (`npm run agent`) normally does this every TICK_MINUTES.
export async function POST(req: Request) {
  if (!isAdmin(req)) return deny();
  const db = await tick();
  if (!db) return Response.json({ ok: false, result: "a round is already running" }, { status: 409 });
  return Response.json({ ok: true, tick: db.tickCount, trades: db.trades.length });
}
export const GET = POST;
