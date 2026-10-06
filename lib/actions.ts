// Every change that comes from OUTSIDE the agent round (admin console, website offer form, email
// webhook, reset). They are applied by whoever holds the database lock – immediately if the database
// is free, otherwise by the running agent round just before it saves. See lib/store.ts.
import { log, resetInPlace, uid } from "./db";
import type { DB } from "./types";
import { acceptOffer, completeTrade } from "./agent/loop";
import { approve as approvePayout, propose } from "./wallet/payouts";
import { isValidRecipient } from "./wallet/solana";

export type Action =
  | { type: "admin"; action: "approve" | "reject" | "received"; offerId: string }
  | { type: "admin"; action: "permission"; venueId: string; permission: "granted" | "pending" | "not_required" | "denied" }
  | { type: "admin"; action: "item_image"; url: string }
  | { type: "wallet"; action: "approve" | "reject"; payoutId: string }
  | { type: "wallet"; action: "pause" | "resume" }
  | { type: "wallet"; action: "manual"; purpose: "tip" | "cost"; to: string; usd: number; label?: string; reason: string }
  | { type: "web_offer"; itemName: string; itemDescription: string; photoUrl?: string; contact: string }
  | { type: "email"; from: string; subject?: string; text: string; messageId?: string }
  | { type: "reset" };

export type QueuedAction = Action & { id: string; at: string };

const PERMS = ["granted", "pending", "not_required", "denied"];

/** Apply one action to the in-memory database. Returns "ok" or a short error. */
export async function applyAction(db: DB, a: Action): Promise<string> {
  const now = new Date().toISOString();
  switch (a.type) {
    case "reset":
      resetInPlace(db);
      return "ok";

    case "web_offer": {
      const id = uid("off_");
      const text = `${a.itemName}: ${a.itemDescription}`;
      db.offers.push({
        id, channel: "web", from: a.contact, threadRef: a.contact, rawText: text,
        itemName: a.itemName, itemDescription: a.itemDescription, photos: a.photoUrl ? [a.photoUrl] : [],
        createdAt: now, status: "new", messages: [{ role: "them", text, at: now }],
      });
      log(db, "offer", `A web visitor offers: ${a.itemName}`, id);
      return "ok";
    }

    case "email": {
      const ref = `${a.from}|${a.messageId || ""}`;
      const existing = db.offers.find((o) => o.channel === "email" && o.from === a.from && ["new", "evaluated", "countered"].includes(o.status));
      if (existing) {
        existing.messages.push({ role: "them", text: a.text, at: now });
        existing.threadRef = ref;
        existing.status = "new";
        return "ok";
      }
      const id = uid("off_");
      db.offers.push({
        id, channel: "email", venueId: "email_brands", from: a.from, threadRef: ref, rawText: a.text,
        itemName: (a.subject || "Email offer").slice(0, 120), itemDescription: a.text.slice(0, 2000), photos: [],
        createdAt: now, status: "new", messages: [{ role: "them", text: a.text, at: now }],
      });
      log(db, "offer", `Email reply from ${a.from}`, id);
      return "ok";
    }

    case "wallet": {
      if (a.action === "pause" || a.action === "resume") {
        db.walletPaused = a.action === "pause";
        log(db, "system", db.walletPaused ? "Wallet payments paused by a human." : "Wallet payments resumed.");
        return "ok";
      }
      if (a.action === "approve") return approvePayout(db, a.payoutId);
      if (a.action === "reject") {
        const p = db.payouts.find((x) => x.id === a.payoutId);
        if (!p) return "no such payment";
        if (["sent", "sending", "simulated"].includes(p.status)) return `payment is already ${p.status}`;
        p.status = "rejected";
        p.why = "vetoed by a human";
        log(db, "system", `Human vetoed payment of $${p.usd} to ${p.toLabel || p.to}.`, p.id);
        return "ok";
      }
      if (a.action === "manual") {
        if (!isValidRecipient(a.to)) return "not a valid Solana address";
        if (!(a.usd > 0 && a.usd <= 10_000)) return "amount must be between $0 and $10,000";
        const p = propose(db, { purpose: a.purpose, usd: a.usd, to: a.to, toLabel: a.label || "manual", reason: a.reason || `Manual ${a.purpose}` });
        if (!p) return "wallet is switched off (WALLET_ENABLED=1)";
        p.status = "awaiting_approval"; // a human created it, so send it right away below
        return approvePayout(db, p.id);
      }
      return "unknown wallet action";
    }

    case "admin": {
      if (a.action === "permission") {
        const v = db.venues.find((x) => x.id === a.venueId);
        if (!v) return "no such venue";
        if (!PERMS.includes(a.permission)) return "bad permission value";
        v.permission = a.permission;
        log(db, "system", `Venue ${v.name} permission → ${a.permission}.`);
        return "ok";
      }
      if (a.action === "item_image") {
        const it = db.items.find((i) => i.id === db.currentItemId);
        if (!it) return "no current item";
        if (a.url && !/^https:\/\/\S+$/i.test(a.url)) return "photo link must start with https://";
        it.imageUrl = a.url || undefined;
        log(db, "system", a.url ? `New photo added for ${it.name}.` : `Photo removed for ${it.name}.`);
        return "ok";
      }
      const o = db.offers.find((x) => x.id === a.offerId);
      if (!o) return "no such offer";
      if (a.action === "approve") {
        if (o.status !== "awaiting_approval") return "offer is not waiting for approval";
        log(db, "system", `Human approved “${o.itemName}”.`, o.id);
        await acceptOffer(db, o);
        return "ok";
      }
      if (a.action === "reject") {
        if (["completed", "rejected", "expired"].includes(o.status)) return `offer is already ${o.status}`;
        o.status = "rejected";
        log(db, "system", `Human vetoed “${o.itemName}”.`, o.id);
        return "ok";
      }
      if (a.action === "received") {
        if (o.status !== "accepted") return "offer is not accepted";
        completeTrade(db, o);
        return "ok";
      }
      return "unknown admin action";
    }
  }
  return "unknown action";
}
