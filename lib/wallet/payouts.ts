// Clippy's spending rules. The AI can only PROPOSE a payment (e.g. a sweetener amount on a trade);
// everything below is plain code the AI cannot change: what it may pay for, how much, to whom, how often.
//
// Flow: propose → (needs_address) → queued → policy check →
//         within limits  → sent automatically (or "simulated" in demo mode)
//         over a limit   → awaiting_approval (a human clicks Approve in /admin)
//         invalid        → rejected
import { config } from "../config";
import { log, uid } from "../db";
import type { DB, Offer, Payout, PayoutPurpose } from "../types";
import { balances, hasWallet, isValidRecipient, NETWORK, send, solUsd, walletAddress } from "./solana";

const num = (k: string, d: number) => (process.env[k] !== undefined && process.env[k] !== "" ? Number(process.env[k]) : d);
export const limits = () => ({
  enabled: process.env.WALLET_ENABLED === "1",
  perPayment: num("WALLET_MAX_PER_PAYMENT_USD", 25),
  perDay: num("WALLET_MAX_PER_DAY_USD", 75),
  perRecipientDay: num("WALLET_MAX_PER_RECIPIENT_DAY_USD", 30),
  shipping: num("WALLET_SHIPPING_USD", 10),
  sweetenerMax: num("WALLET_SWEETENER_MAX_USD", 25),
  sweetenerPctOfItem: num("WALLET_SWEETENER_MAX_PCT", 10),
  tip: num("WALLET_TIP_USD", 2),
  tipsPerDay: num("WALLET_TIPS_PER_DAY", 5),
  solReserve: num("WALLET_MIN_SOL_RESERVE", 0.02),
});

/** Approved suppliers for running costs: WALLET_PAYEES="name:ADDRESS,name2:ADDRESS" */
export function payees(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (process.env.WALLET_PAYEES || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, addr] = part.split(":").map((s) => s.trim());
    if (name && addr && isValidRecipient(addr)) out[name] = addr;
  }
  return out;
}

/** Recurring bills: WALLET_BILLS="name:USD:everyDays,…" (name must be in WALLET_PAYEES) */
function bills(): { name: string; usd: number; days: number }[] {
  return (process.env.WALLET_BILLS || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, usd, days] = s.split(":");
    return { name, usd: Number(usd), days: Number(days) || 30 };
  }).filter((b) => b.name && b.usd > 0);
}

const tokenFor = (p: PayoutPurpose): "USDC" | "SOL" => (p === "tip" ? "SOL" : "USDC");
const DAY = 86_400_000;
const spentStatuses = ["sending", "sent", "simulated"];
const within24h = (db: DB) => db.payouts.filter((p) => spentStatuses.includes(p.status) && Date.now() - Date.parse(p.sentAt || p.createdAt) < DAY);

export function spentToday(db: DB) {
  return within24h(db).reduce((s, p) => s + p.usd, 0);
}

// ---------------------------------------------------------------- proposing
/** Create a payout request. Amount is in USD; it is converted to the token when sent. */
export function propose(db: DB, p: { purpose: PayoutPurpose; usd: number; to?: string; toLabel?: string; offerId?: string; reason: string }): Payout | null {
  const L = limits();
  if (!L.enabled || !(p.usd > 0)) return null;
  if (p.offerId && db.payouts.some((x) => x.offerId === p.offerId && x.purpose === p.purpose && x.status !== "rejected")) return null; // one per offer & purpose
  const payout: Payout = {
    id: uid("pay_"), purpose: p.purpose, to: p.to || "", toLabel: p.toLabel, token: tokenFor(p.purpose), amount: 0,
    usd: +p.usd.toFixed(2), offerId: p.offerId, reason: p.reason, status: p.to ? "queued" : "needs_address", createdAt: new Date().toISOString(),
  };
  db.payouts.push(payout);
  log(db, "system", `Payment proposed: $${payout.usd} ${payout.token} (${p.purpose}) to ${p.toLabel || "?"}${p.to ? "" : " – waiting for their Solana address"}.`, payout.id);
  return payout;
}

/** When a trade completes: reimburse shipping, pay any agreed sweetener, and say thanks with a small tip. */
export function onTradeCompleted(db: DB, o: Offer, itemValueUsd: number) {
  const L = limits();
  if (!L.enabled) return;
  const label = o.from;
  if (L.shipping > 0) propose(db, { purpose: "shipping", usd: L.shipping, to: o.payoutAddress, toLabel: label, offerId: o.id, reason: `Shipping for “${o.itemName}”` });
  const sw = Math.min(o.evaluation?.sweetenerUsd || 0, L.sweetenerMax, (itemValueUsd * L.sweetenerPctOfItem) / 100);
  if (sw >= 1) propose(db, { purpose: "sweetener", usd: Math.floor(sw), to: o.payoutAddress, toLabel: label, offerId: o.id, reason: `Agreed sweetener on “${o.itemName}”` });
  if (L.tip > 0) propose(db, { purpose: "tip", usd: L.tip, to: o.payoutAddress, toLabel: label, offerId: o.id, reason: `Thanks for trading “${o.itemName}”` });
}

/** An address arrived from this person – fill in any of their payouts that were waiting for it. */
export function attachAddress(db: DB, from: string, addr: string) {
  for (const p of db.payouts) {
    if (p.status === "needs_address" && p.toLabel === from) {
      p.to = addr;
      p.status = "queued";
    }
  }
}

// ---------------------------------------------------------------- policy
type Verdict = { ok: true } | { ok: false; hard: boolean; why: string };

export function check(db: DB, p: Payout): Verdict {
  const L = limits();
  if (!L.enabled) return { ok: false, hard: true, why: "wallet is switched off (WALLET_ENABLED)" };
  if (db.walletPaused) return { ok: false, hard: false, why: "payments are paused" };
  if (!isValidRecipient(p.to)) return { ok: false, hard: true, why: "not a valid Solana wallet address" };
  if (p.to === walletAddress()) return { ok: false, hard: true, why: "can't pay itself" };
  if (p.purpose === "cost" && !Object.values(payees()).includes(p.to)) return { ok: false, hard: true, why: "running costs can only go to approved suppliers (WALLET_PAYEES)" };
  if (p.usd > L.perPayment) return { ok: false, hard: false, why: `over the $${L.perPayment} per-payment limit` };
  if (spentToday(db) + p.usd > L.perDay) return { ok: false, hard: false, why: `would pass the $${L.perDay} daily limit` };
  const toRecipient = within24h(db).filter((x) => x.to === p.to).reduce((s, x) => s + x.usd, 0);
  if (toRecipient + p.usd > L.perRecipientDay) return { ok: false, hard: false, why: `over the $${L.perRecipientDay}/day limit for one recipient` };
  if (p.purpose === "tip" && within24h(db).filter((x) => x.purpose === "tip").length >= L.tipsPerDay) return { ok: false, hard: false, why: `already sent ${L.tipsPerDay} tips today` };
  return { ok: true };
}

// ---------------------------------------------------------------- executing
async function execute(db: DB, p: Payout): Promise<void> {
  if (config.mode === "demo" || !hasWallet()) {
    p.amount = p.token === "USDC" ? p.usd : +(p.usd / 150).toFixed(6);
    p.status = "simulated";
    p.sentAt = new Date().toISOString();
    log(db, "system", `(demo) Would pay $${p.usd} ${p.token} to ${p.toLabel || p.to} – ${p.reason}.`, p.id);
    return;
  }
  if (p.token === "SOL") {
    const px = await solUsd();
    if (!px) {
      p.status = "awaiting_approval";
      p.why = "SOL price unavailable";
      return;
    }
    p.amount = +(p.usd / px).toFixed(6);
  } else p.amount = p.usd;

  const bal = await balances();
  const needSol = (p.token === "SOL" ? p.amount : 0) + limits().solReserve;
  if (bal.sol < needSol || (p.token === "USDC" && bal.usdc < p.amount)) {
    p.status = "awaiting_approval";
    p.why = `not enough in the wallet (has ${bal.usdc.toFixed(2)} USDC, ${bal.sol.toFixed(4)} SOL)`;
    log(db, "error", `Wallet too low to pay $${p.usd} ${p.token} to ${p.toLabel || p.to}. Top it up.`, p.id);
    return;
  }
  p.status = "sending";
  try {
    p.signature = await send(p.to, p.token, p.amount);
    p.status = "sent";
    p.sentAt = new Date().toISOString();
    log(db, "system", `Paid ${p.amount} ${p.token} ($${p.usd}) to ${p.toLabel || p.to} – ${p.reason}.`, p.id);
  } catch (e: any) {
    p.status = "failed";
    p.why = String(e.message || e).slice(0, 200);
    log(db, "error", `Payment to ${p.toLabel || p.to} failed: ${p.why}`, p.id);
  }
}

/** Run once per agent round: queue due bills, then send everything that passes the rules. */
export async function processPayouts(db: DB) {
  const L = limits();
  if (!L.enabled) return;
  const P = payees();
  for (const b of bills()) {
    const addr = P[b.name];
    if (!addr) continue;
    const last = db.payouts.filter((p) => p.purpose === "cost" && p.to === addr && p.status !== "rejected").at(-1);
    if (!last || Date.now() - Date.parse(last.createdAt) > b.days * DAY) propose(db, { purpose: "cost", usd: b.usd, to: addr, toLabel: b.name, reason: `Running cost: ${b.name}` });
  }
  for (const p of db.payouts.filter((x) => x.status === "queued")) {
    const v = check(db, p);
    if (v.ok) await execute(db, p);
    else if (v.hard) {
      p.status = "rejected";
      p.why = v.why;
      log(db, "policy", `Payment to ${p.toLabel || p.to} refused: ${v.why}.`, p.id);
    } else {
      p.status = "awaiting_approval";
      p.why = v.why;
      log(db, "policy", `Payment of $${p.usd} to ${p.toLabel || p.to} needs approval: ${v.why}.`, p.id);
    }
  }
  if (config.mode !== "demo" && hasWallet()) {
    try {
      db.walletBalance = { ...(await balances()), at: new Date().toISOString() };
    } catch {
      /* RPC hiccup – keep the old figure */
    }
  }
}

/** A human approved it in /admin: skip the spending limits, but never the safety checks. */
export async function approve(db: DB, id: string): Promise<string> {
  const p = db.payouts.find((x) => x.id === id);
  if (!p) return "no such payment";
  if (!["awaiting_approval", "failed"].includes(p.status)) return `payment is ${p.status}`;
  if (!limits().enabled) return "wallet is switched off";
  if (!isValidRecipient(p.to)) return "not a valid Solana address";
  log(db, "system", `Human approved payment of $${p.usd} to ${p.toLabel || p.to}.`, p.id);
  await execute(db, p);
  return p.status === "sent" || p.status === "simulated" ? "ok" : p.why || p.status;
}

export function publicTreasury(db: DB) {
  const L = limits();
  const short = (a: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
  const label = (l?: string) => (!l ? "" : /\S+@\S+\.\S+/.test(l) ? "private" : l); // never show email addresses
  return {
    enabled: L.enabled,
    network: NETWORK,
    address: walletAddress(),
    balance: db.walletBalance ?? null,
    paused: !!db.walletPaused,
    spentToday: +spentToday(db).toFixed(2),
    dailyLimit: L.perDay,
    payouts: db.payouts.slice(-12).reverse().map((p) => ({
      id: p.id, purpose: p.purpose, token: p.token, usd: p.usd, amount: p.amount, status: p.status,
      to: short(p.to), toLabel: label(p.toLabel), reason: p.reason, signature: p.signature, at: p.sentAt || p.createdAt,
    })),
  };
}
