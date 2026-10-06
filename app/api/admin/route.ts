import { isAdmin, deny } from "@/lib/admin";
import { inboxSize, isLocked, load } from "@/lib/db";
import { submit } from "@/lib/store";
import type { Action } from "@/lib/actions";
import { limits, payees, publicTreasury } from "@/lib/wallet/payouts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdmin(req)) return deny();
  const db = load();
  return Response.json({ ...db, roundRunning: isLocked(), pendingActions: inboxSize(), treasury: publicTreasury(db), walletLimits: limits(), payees: payees() });
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return deny();
  const b = await req.json().catch(() => ({}));
  let a: Action;
  if (b.action === "reset") a = { type: "reset" };
  else if (b.action === "permission") a = { type: "admin", action: "permission", venueId: String(b.venueId), permission: b.permission };
  else if (b.action === "wallet_approve" || b.action === "wallet_reject") a = { type: "wallet", action: b.action === "wallet_approve" ? "approve" : "reject", payoutId: String(b.payoutId) };
  else if (b.action === "wallet_pause" || b.action === "wallet_resume") a = { type: "wallet", action: b.action === "wallet_pause" ? "pause" : "resume" };
  else if (b.action === "wallet_manual") a = { type: "wallet", action: "manual", purpose: b.purpose === "cost" ? "cost" : "tip", to: String(b.to || "").trim(), usd: Number(b.usd), label: b.label, reason: String(b.reason || "") };
  else if (b.action === "item_image") a = { type: "admin", action: "item_image", url: String(b.url || "").trim() };
  else if (["approve", "reject", "received"].includes(b.action)) a = { type: "admin", action: b.action, offerId: String(b.offerId) };
  else return Response.json({ ok: false, result: "unknown action" }, { status: 400 });

  const r = await submit(a);
  if (!r.applied) return Response.json({ ok: true, queued: true, result: "queued – an agent round is running; it will apply this before it saves" }, { status: 202 });
  return Response.json({ ok: r.result === "ok", result: r.result }, { status: r.result === "ok" ? 200 : 400 });
}
