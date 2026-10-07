"use client";
import { useState } from "react";
import { CountUp, money } from "./ui";

export interface TreasuryData {
  enabled: boolean;
  network: string;
  address: string | null;
  balance: { sol: number; usdc: number; at: string } | null;
  paused: boolean;
  spentToday: number;
  dailyLimit: number;
  payouts: { id: string; purpose: string; token: string; usd: number; amount: number; status: string; to: string; toLabel?: string; reason: string; signature?: string; at: string }[];
}

const PURPOSE: Record<string, string> = { shipping: "Shipping refund", sweetener: "Trade sweetener", tip: "Thank-you tip", cost: "Running cost" };
const STATUS: Record<string, string> = {
  sent: "st-good", simulated: "st-dim", awaiting_approval: "st-warn", needs_address: "st-dim", queued: "st-new", sending: "st-new", failed: "st-bad", rejected: "st-bad",
};
const STATUS_LABEL: Record<string, string> = { awaiting_approval: "needs approval", needs_address: "waiting for address", simulated: "demo" };
const scan = (s: string, net: string, kind = "tx") => `https://solscan.io/${kind}/${s}${net === "devnet" ? "?cluster=devnet" : ""}`;

export function Treasury({ t }: { t: TreasuryData }) {
  const [copied, setCopied] = useState(false);
  const pct = Math.min(100, (t.spentToday / Math.max(t.dailyLimit, 1)) * 100);
  return (
    <section className="sec treasury">
      <div className="sec-h">
        <span className="no">$</span>
        <h2>Clippy&apos;s wallet</h2>
        <span className="aside">Solana · {t.network}{!t.enabled ? " · not switched on yet" : ""}{t.paused ? " · payments paused" : ""} · <a href="/docs#wallet">how it works</a></span>
      </div>
      <div className="tr-grid">
        <div className="tr-card">
          <div className="tr-k">Address</div>
          {t.address ? (
            <div className="tr-addr">
              <a href={scan(t.address, t.network, "account")} target="_blank" rel="noreferrer">{t.address.slice(0, 6)}…{t.address.slice(-6)}</a>
              <button className="ghost" onClick={() => { navigator.clipboard?.writeText(t.address!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
            </div>
          ) : <div className="muted small">not created yet</div>}
          <div className="tr-bal">
            <div><span>USDC</span><b>{t.balance ? <CountUp value={t.balance.usdc} format={(n) => n.toFixed(2)} /> : "—"}</b></div>
            <div><span>SOL</span><b>{t.balance ? <CountUp value={t.balance.sol} format={(n) => n.toFixed(3)} /> : "—"}</b></div>
          </div>
          <div className="tr-k" style={{ marginTop: 16 }}>Spent in the last 24h</div>
          <div className="tr-limit"><i style={{ width: `${pct}%` }} /></div>
          <div className="tr-limit-l"><span>{money(t.spentToday)}</span><span>limit {money(t.dailyLimit)}</span></div>
          <p className="tr-note">Clippy pays shipping refunds, small trade sweeteners, thank-you tips and approved running costs. Hard limits are enforced in code; anything bigger needs a human.</p>
        </div>
        <div className="tr-list">
          <div className="offers-h"><span>Payments</span><span className="muted">newest first</span></div>
          {t.payouts.length === 0 ? <p className="empty" style={{ padding: "10px 0" }}>No payments yet.</p> : (
            <ul>
              {t.payouts.map((p, i) => (
                <li key={p.id} style={{ animationDelay: `${i * 50}ms` }}>
                  <span className="o-main"><b>{PURPOSE[p.purpose] ?? p.purpose}</b><small>to {p.toLabel || p.to} · {p.reason}</small></span>
                  <span className={`o-st ${STATUS[p.status] ?? "st-dim"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                  <span className="o-v">
                    {money(p.usd)}
                    {p.signature ? <a className="x" href={scan(p.signature, t.network)} target="_blank" rel="noreferrer">{p.token} ↗</a> : <em className="x low">{p.token}</em>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
