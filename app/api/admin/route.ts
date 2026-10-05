import { isAdmin, deny } from "@/lib/admin";
import { load, log, mutate, resetDb } from "@/lib/db";
import { acceptOffer, completeTrade } from "@/lib/agent/loop";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdmin(req)) return deny();
  return Response.json(load());
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return deny();
  const { action, offerId, venueId, permission } = await req.json();
  if (action === "reset") {
    resetDb();
    return Response.json({ ok: true });
  }
  const out = await mutate(async (db) => {
    const o = db.offers.find((x) => x.id === offerId);
    switch (action) {
      case "approve":
        if (!o || o.status !== "awaiting_approval") return "offer not awaiting approval";
        log(db, "system", `Human approved “${o.itemName}”.`, o.id);
        await acceptOffer(db, o);
        return "ok";
      case "reject":
        if (!o) return "no offer";
        o.status = "rejected";
        log(db, "system", `Human vetoed “${o.itemName}”.`, o.id);
        return "ok";
      case "received":
        if (!o || o.status !== "accepted") return "offer not accepted";
        completeTrade(db, o);
        return "ok";
      case "permission": {
        const v = db.venues.find((x) => x.id === venueId);
        if (!v) return "no venue";
        v.permission = permission;
        log(db, "system", `Venue ${v.name} permission → ${permission}.`);
        return "ok";
      }
    }
    return "unknown action";
  });
  return Response.json({ ok: out === "ok", result: out }, { status: out === "ok" ? 200 : 400 });
}
