// Clippy's spending rules. The AI can only PROPOSE a payment (e.g. a sweetener amount on a trade);
// everything below is plain code the AI cannot change: what it may pay for, how much, to whom, how often.
//
// Flow: propose → (needs_address) → queued → policy check →
//         within limits  → sent automatically (or "simulated" in demo mode)
//         over a limit   → awaiting_approval (a human clicks Approve in /admin)
//         invalid        → rejected
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { log, uid } from "../db";
import type { DB, Offer, Payout, PayoutPurpose } from "../types";
import { balances, broadcast, hasWallet, isValidRecipient, NETWORK, prepare, solUsd, txStatus, walletAddress } from "./solana";

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

// ---------------------------------------------------------------- journal
// Every signed transaction is written here (synced to disk) BEFORE it is broadcast. db.json is only
// saved at the end of a round, so after a crash or timeout this file is the source of truth: before
// paying anything we ask the chain about every earlier attempt for the same payment.
const JOURNAL = path.join(path.dirname(process.env.DB_FILE || path.join(process.cwd(), "data", "db.json")), "wallet-journal.jsonl");
interface JEntry { key: string; payoutId: string; to: string; token: "SOL" | "USDC"; amount: number; usd: number; purpose: PayoutPurpose; signature: string; lastValidBlockHeight: number; at: string }

/** Same key = same real-world payment, even if the payout record was re-created after a crash. */
const keyOf = (p: Payout) => (p.offerId ? `offer:${p.offerId}:${p.purpose}` : `id:${p.id}`);

function journal(): JEntry[] {
  try {
    return fs.readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
function journalAppend(e: JEntry) {
  fs.mkdirSync(path.dirname(JOURNAL), { recursive: true });
  const fd = fs.openSync(JOURNAL, "a", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(e) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Look up every earlier signed attempt for this payment on-chain.
 *  "paid"    – one of them landed: mark it sent, never pay again
 *  "pending" – one could still land: wait
 *  "unknown" – couldn't reach Solana: do nothing this time
 *  "clear"   – none landed and none can: safe to send
 */
async function reconcile(db: DB, p: Payout): Promise<"paid" | "pending" | "unknown" | "clear"> {
  const tries = journal().filter((j) => j.key === keyOf(p)).reverse();
  for (const j of tries) {
    let st: Awaited<ReturnType<typeof txStatus>>;
    try {
      st = await txStatus(j.signature, j.lastValidBlockHeight);
    } catch {
      p.why = "couldn't reach Solana to check an earlier attempt – will retry";
      return "unknown";
    }
    if (st === "landed") {
      Object.assign(p, { status: "sent", signature: j.signature, amount: j.amount, sentAt: p.sentAt || j.at, why: undefined });
      log(db, "system", `Payment to ${p.toLabel || p.to} confirmed on-chain ($${p.usd} ${p.token}).`, p.id);
      return "paid";
    }
    if (st === "pending") {
      Object.assign(p, { status: "sending", signature: j.signature, why: "sent – waiting for the network to confirm" });
      return "pending";
    }
  }
  return "clear";
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

/** The counterparty of THIS offer sent an address – fill in that offer's payouts that were waiting for it. */
export function attachAddress(db: DB, offerId: string, addr: string) {
  if (!isValidRecipient(addr)) return;
  for (const p of db.payouts) {
    if (p.status === "needs_address" && p.offerId === offerId) {
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
  // 1. Never pay twice: check every earlier attempt for this payment first.
  const prior = await reconcile(db, p);
  if (prior !== "clear") return;

  // 2. Price + balance.
  if (p.token === "SOL") {
    const px = await solUsd();
    if (!px) {
      p.status = "awaiting_approval";
      p.why = "SOL price unavailable";
      return;
    }
    p.amount = +(p.usd / px).toFixed(6);
  } else p.amount = p.usd;
  let bal: { sol: number; usdc: number };
  try {
    bal = await balances();
  } catch {
    p.why = "couldn't reach Solana – will retry";
    return;
  }
  const needSol = (p.token === "SOL" ? p.amount : 0) + limits().solReserve;
  if (bal.sol < needSol || (p.token === "USDC" && bal.usdc < p.amount)) {
    p.status = "awaiting_approval";
    p.why = `not enough in the wallet (has ${bal.usdc.toFixed(2)} USDC, ${bal.sol.toFixed(4)} SOL)`;
    log(db, "error", `Wallet too low to pay $${p.usd} ${p.token} to ${p.toLabel || p.to}. Top it up.`, p.id);
    return;
  }

  // 3. Sign, write the signature to disk, THEN broadcast.
  let tx: Awaited<ReturnType<typeof prepare>>;
  try {
    tx = await prepare(p.to, p.token, p.amount);
  } catch (e: any) {
    p.why = `couldn't build the transaction: ${String(e.message || e).slice(0, 120)} – will retry`;
    return;
  }
  journalAppend({ key: keyOf(p), payoutId: p.id, to: p.to, token: p.token, amount: p.amount, usd: p.usd, purpose: p.purpose, signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight, at: new Date().toISOString() });
  p.signature = tx.signature;
  p.status = "sending";
  try {
    await broadcast(tx);
    p.status = "sent";
    p.why = undefined;
    p.sentAt = new Date().toISOString();
    log(db, "system", `Paid ${p.amount} ${p.token} ($${p.usd}) to ${p.toLabel || p.to} – ${p.reason}.`, p.id);
  } catch (e: any) {
    // Timeouts don't mean it failed. Ask the chain.
    let st: Awaited<ReturnType<typeof txStatus>> | "unknown" = "unknown";
    try {
      st = await txStatus(tx.signature, tx.lastValidBlockHeight);
    } catch {}
    if (st === "landed") {
      Object.assign(p, { status: "sent", sentAt: new Date().toISOString(), why: undefined });
      log(db, "system", `Paid ${p.amount} ${p.token} ($${p.usd}) to ${p.toLabel || p.to} – ${p.reason}.`, p.id);
    } else if (st === "pending" || st === "unknown") {
      p.why = "sent – waiting for the network to confirm (checked again every round)";
    } else {
      p.status = "failed";
      p.why = st === "expired" ? "didn't go through – no money moved, safe to approve again" : `failed on-chain – no money moved (${String(e.message || e).slice(0, 100)})`;
      log(db, "error", `Payment to ${p.toLabel || p.to} didn't go through: ${p.why}.`, p.id);
    }
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
    const lastDb = db.payouts.filter((p) => p.purpose === "cost" && p.to === addr && p.status !== "rejected").at(-1)?.createdAt;
    const lastJ = journal().filter((j) => j.purpose === "cost" && j.to === addr).at(-1)?.at; // survives a crash
    const last = Math.max(Date.parse(lastDb || "") || 0, Date.parse(lastJ || "") || 0);
    if (Date.now() - last > b.days * DAY) propose(db, { purpose: "cost", usd: b.usd, to: addr, toLabel: b.name, reason: `Running cost: ${b.name}` });
  }
  // Anything sent but not yet confirmed: ask the chain. If it can no longer land, re-queue it (limits re-checked).
  for (const p of db.payouts.filter((x) => x.status === "sending")) {
    if (config.mode === "demo" || !hasWallet()) continue;
    const r = await reconcile(db, p);
    if (r === "clear") {
      p.status = "queued";
      p.why = "previous attempt didn't land – retrying";
    }
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
  await execute(db, p); // checks the chain for earlier attempts first – a "failed" payment that actually landed is never paid twice
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
    // the rules are public on purpose: anyone can check Clippy keeps to them
    limits: { perPayment: L.perPayment, perDay: L.perDay, perRecipientDay: L.perRecipientDay, shipping: L.shipping, sweetenerMax: L.sweetenerMax, sweetenerPct: L.sweetenerPctOfItem, tip: L.tip, tipsPerDay: L.tipsPerDay },
    totals: (() => {
      const done = db.payouts.filter((p) => p.status === "sent" || p.status === "simulated");
      const by = (k: PayoutPurpose) => +done.filter((p) => p.purpose === k).reduce((s, p) => s + p.usd, 0).toFixed(2);
      return { count: done.length, usd: +done.reduce((s, p) => s + p.usd, 0).toFixed(2), shipping: by("shipping"), sweetener: by("sweetener"), tip: by("tip"), cost: by("cost"), waiting: db.payouts.filter((p) => ["awaiting_approval", "needs_address", "queued", "sending"].includes(p.status)).length };
    })(),
    payouts: db.payouts.slice(-12).reverse().map((p) => ({
      id: p.id, purpose: p.purpose, token: p.token, usd: p.usd, amount: p.amount, status: p.status,
      to: short(p.to), toLabel: label(p.toLabel), reason: p.reason, signature: p.signature, at: p.sentAt || p.createdAt,
    })),
  };
}
