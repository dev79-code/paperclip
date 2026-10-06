// Solana I/O for Clippy's wallet: key loading, balances, SOL/USDC transfers.
// The secret key lives ONLY in data/wallet.json on the server (chmod 600), created by `npm run wallet:create`.
// It is never logged, never sent to the AI, never returned by any API.
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const NETWORK = (process.env.WALLET_NETWORK === "mainnet" ? "mainnet" : "devnet") as "mainnet" | "devnet";
export const RPC_URL = process.env.SOLANA_RPC_URL || (NETWORK === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");
export const USDC_MINT = new PublicKey(
  process.env.USDC_MINT || (NETWORK === "mainnet" ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
);
const USDC_DECIMALS = 6;
export const KEY_FILE = path.join(process.cwd(), "data", "wallet.json");

export const explorer = (sigOrAddr: string, kind: "tx" | "account" = "tx") =>
  `https://solscan.io/${kind}/${sigOrAddr}${NETWORK === "devnet" ? "?cluster=devnet" : ""}`;

let conn: Connection | null = null;
export const connection = () => (conn ??= new Connection(RPC_URL, "confirmed"));

export function hasWallet() {
  return fs.existsSync(KEY_FILE);
}

export function loadKeypair(): Keypair {
  const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw.secretKey));
}

export function walletAddress(): string | null {
  try {
    return JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).publicKey ?? null;
  } catch {
    return null;
  }
}

export function createWallet(): string {
  if (hasWallet()) throw new Error(`a wallet already exists at ${KEY_FILE} – refusing to overwrite it`);
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify({ publicKey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey), network: NETWORK, createdAt: new Date().toISOString() }), { mode: 0o600 });
  fs.chmodSync(KEY_FILE, 0o600);
  return kp.publicKey.toBase58();
}

// Well-known program / mint addresses that must never receive a payment.
const BLOCKED = new Set([
  "11111111111111111111111111111111", // system program (all zeros – technically on-curve)
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // token program
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // associated token program
  "ComputeBudget111111111111111111111111111111",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mainnet mint
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // USDC devnet mint
  "So11111111111111111111111111111111111111112", // wrapped SOL mint
]);

/** A normal wallet address (on the ed25519 curve) – rejects program-derived, well-known program and malformed addresses. */
export function isValidRecipient(addr: string): boolean {
  try {
    if (!addr || BLOCKED.has(addr)) return false;
    const pk = new PublicKey(addr);
    const bytes = pk.toBytes();
    if (bytes.every((b) => b === 0)) return false;
    return PublicKey.isOnCurve(bytes) && pk.toBase58() === addr;
  } catch {
    return false;
  }
}

/** Pull a Solana address out of a message someone sent us (base58, 32–44 chars, on-curve). */
export function findAddress(text: string): string | undefined {
  for (const m of text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || []) if (isValidRecipient(m)) return m;
  return undefined;
}

export async function balances(): Promise<{ sol: number; usdc: number }> {
  const owner = new PublicKey(walletAddress()!);
  const c = connection();
  const lamports = await c.getBalance(owner);
  let usdc = 0;
  try {
    const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);
    const b = await c.getTokenAccountBalance(ata);
    usdc = Number(b.value.uiAmount || 0);
  } catch {
    /* no USDC account yet */
  }
  return { sol: lamports / LAMPORTS_PER_SOL, usdc };
}

/** Build (but don't send) a transfer – exported so it can be tested offline. */
export function buildTransfer(from: PublicKey, to: string, token: "SOL" | "USDC", amount: number): Transaction {
  const dest = new PublicKey(to);
  const tx = new Transaction();
  if (token === "SOL") {
    tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: dest, lamports: Math.round(amount * LAMPORTS_PER_SOL) }));
  } else {
    const fromAta = getAssociatedTokenAddressSync(USDC_MINT, from);
    const toAta = getAssociatedTokenAddressSync(USDC_MINT, dest);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, dest, USDC_MINT)); // creates their USDC account if missing
    tx.add(createTransferCheckedInstruction(fromAta, USDC_MINT, toAta, from, BigInt(Math.round(amount * 10 ** USDC_DECIMALS)), USDC_DECIMALS));
  }
  return tx;
}

export async function send(to: string, token: "SOL" | "USDC", amount: number): Promise<string> {
  const kp = loadKeypair();
  const tx = buildTransfer(kp.publicKey, to, token, amount);
  return sendAndConfirmTransaction(connection(), tx, [kp], { commitment: "confirmed" });
}

/** SOL price in USD (CoinGecko), cached for 5 minutes. Falls back to SOL_USD_FALLBACK, else null. */
let px: { v: number; at: number } | null = null;
export async function solUsd(): Promise<number | null> {
  if (px && Date.now() - px.at < 300_000) return px.v;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
    const v = Number((await r.json())?.solana?.usd);
    if (v > 0) {
      px = { v, at: Date.now() };
      return v;
    }
  } catch {
    /* fall through */
  }
  const f = Number(process.env.SOL_USD_FALLBACK || 0);
  return f > 0 ? f : null;
}
