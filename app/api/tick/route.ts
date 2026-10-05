import { isAdmin, deny } from "@/lib/admin";
import { tick } from "@/lib/agent/loop";
export const runtime = "nodejs";
export const maxDuration = 300;

// Trigger one agent round. Point a cron (Vercel Cron, GitHub Actions, etc.) at this with ?key=ADMIN_PASSWORD,
// or run the long-lived worker instead: `npm run agent`.
export async function POST(req: Request) {
  if (!isAdmin(req)) return deny();
  const db = await tick();
  return Response.json({ ok: true, tick: db.tickCount, trades: db.trades.length });
}
export const GET = POST;
