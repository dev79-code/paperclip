"use client";
import { useCallback, useEffect, useState } from "react";
import type { DB, Offer } from "@/lib/types";

const fmt = (n?: number) => (n == null ? "–" : n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`);

export default function Admin() {
  const [key, setKey] = useState("");
  const [db, setDb] = useState<DB | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setKey(sessionStorage.getItem("pc_admin") || ""); } catch {}
  }, []);

  const refresh = useCallback(async (k = key) => {
    if (!k) return;
    const r = await fetch("/api/admin", { headers: { "x-admin-key": k } });
    if (!r.ok) { setErr("Wrong password"); setDb(null); return; }
    setErr("");
    setDb(await r.json());
    try { sessionStorage.setItem("pc_admin", k); } catch {}
  }, [key]);

  useEffect(() => { if (key) refresh(key); }, [key, refresh]);

  async function act(body: Record<string, string>) {
    setBusy(true);
    const r = await fetch("/api/admin", { method: "POST", headers: { "x-admin-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setErr(r.ok ? "" : j.result || "failed");
    setNote(r.status === 202 ? "Queued: an agent round is running and will apply this before it saves (usually within a minute)." : "");
    await refresh();
    setBusy(false);
  }
  async function runTick() {
    setBusy(true);
    const r = await fetch("/api/tick", { method: "POST", headers: { "x-admin-key": key } });
    setNote(r.status === 409 ? "A round is already running." : "");
    await refresh();
    setBusy(false);
  }

  if (!db)
    return (
      <main className="wrap" style={{ maxWidth: 420 }}>
        <h1>Custodian</h1>
        <form onSubmit={(e) => { e.preventDefault(); const k = new FormData(e.currentTarget).get("k") as string; setKey(k); refresh(k); }}>
          <input name="k" type="password" placeholder="ADMIN_PASSWORD" />
          <button>Enter</button>
          {err && <p style={{ color: "var(--bad)" }}>{err}</p>}
        </form>
      </main>
    );

  const cur = db.items.find((i) => i.id === db.currentItemId)!;
  const by = (s: Offer["status"][]) => db.offers.filter((o) => s.includes(o.status)).reverse();

  return (
    <main className="wrap">
      <header className="top">
        <a href="/" className="brand">← Clippy.fun · Custodian</a>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={runTick} disabled={busy}>Run one round now</button>
          <button className="ghost" disabled={busy} onClick={() => confirm("Reset everything back to one paperclip?") && act({ action: "reset" })}>Reset</button>
        </div>
      </header>
      {err && <p style={{ color: "var(--bad)" }}>{err}</p>}
      {note && <p style={{ color: "var(--warn)" }}>{note}</p>}
      {db && ((db as any).roundRunning || (db as any).pendingActions > 0) && (
        <p className="small muted">{(db as any).roundRunning ? "An agent round is running. " : ""}{(db as any).pendingActions > 0 ? `${(db as any).pendingActions} change(s) queued.` : ""}</p>
      )}
      <p className="muted">Holding <b>{cur.name}</b> (~{fmt(cur.estValueUsd)}) · round {db.tickCount} · {db.trades.length} trades</p>
      <form className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "12px 0 0" }}
        onSubmit={(e) => { e.preventDefault(); const url = (new FormData(e.currentTarget).get("url") as string) || ""; act({ action: "item_image", url }); }}>
        <span className="small muted" style={{ flex: "0 0 auto" }}>Photo of <b>{cur.name}</b> (shown on the site):</span>
        <input name="url" type="url" placeholder="https://… link to a photo" defaultValue={cur.imageUrl || ""} key={cur.id} style={{ flex: "1 1 260px", margin: 0 }} />
        <button disabled={busy}>Save photo</button>
      </form>

      <Section title="Needs your approval" empty="Nothing waiting.">
        {by(["awaiting_approval"]).map((o) => (
          <OfferCard key={o.id} o={o} cur={cur.estValueUsd}>
            <button disabled={busy} onClick={() => act({ action: "approve", offerId: o.id })}>Approve trade</button>
            <button className="ghost" disabled={busy} onClick={() => act({ action: "reject", offerId: o.id })}>Veto</button>
          </OfferCard>
        ))}
      </Section>

      <Section title="Accepted – waiting for the item to arrive" empty="No items in transit.">
        {by(["accepted"]).map((o) => (
          <OfferCard key={o.id} o={o} cur={cur.estValueUsd}>
            <p className="small muted">Arrange shipping with {o.from} (Shippo/EasyPost label, escrow above your limit). When it arrives and matches the description:</p>
            <button disabled={busy} onClick={() => act({ action: "received", offerId: o.id })}>Item received & verified → complete trade</button>
            <button className="ghost" disabled={busy} onClick={() => act({ action: "reject", offerId: o.id })}>Problem – cancel</button>
          </OfferCard>
        ))}
      </Section>

      <WalletAdmin db={db as any} busy={busy} act={act} />

      <Section title="Venues & permissions" empty="">
        <div className="card table-scroll">
          <table>
            <thead><tr><th>Venue</th><th>Channel</th><th>Range</th><th>Cooldown</th><th>Stats</th><th>Permission</th></tr></thead>
            <tbody>
              {db.venues.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}<br /><span className="small muted">{v.formatHint}</span></td>
                  <td className="mono small">{v.channel}</td>
                  <td className="mono small">{fmt(v.minValueUsd)}–{v.maxValueUsd > 1e8 ? "∞" : fmt(v.maxValueUsd)}</td>
                  <td className="mono small">{v.cooldownHours}h</td>
                  <td className="mono small">{v.stats.posts}p / {v.stats.offers}o / {v.stats.accepted}d</td>
                  <td>
                    <select value={v.permission} onChange={(e) => act({ action: "permission", venueId: v.id, permission: e.target.value })}>
                      {["pending", "granted", "not_required", "denied"].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">In LIVE mode the agent only posts to venues marked granted / not_required. Get mod/admin permission first.</p>
      </Section>

      <Section title="Recent offers" empty="No offers yet.">
        <div className="card table-scroll">
          <table>
            <thead><tr><th>From</th><th>Item</th><th>Value</th><th>Status</th><th>Why</th></tr></thead>
            <tbody>
              {db.offers.slice(-40).reverse().map((o) => (
                <tr key={o.id}>
                  <td className="small">{o.from}<br /><span className="muted mono">{o.channel}</span></td>
                  <td>{o.itemName}</td>
                  <td className="mono small">{fmt(o.evaluation?.estValueUsd)}</td>
                  <td className="mono small">{o.status}</td>
                  <td className="small muted">{o.evaluation?.reasoning}{o.evaluation?.policyFlags.length ? ` · flags: ${o.evaluation.policyFlags.join(", ")}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section style={{ marginTop: 24 }}>
      <h2>{title}</h2>
      <div className="grid">{has ? children : <p className="muted small">{empty}</p>}</div>
    </section>
  );
}

function OfferCard({ o, cur, children }: { o: Offer; cur: number; children: React.ReactNode }) {
  const ev = o.evaluation;
  return (
    <div className="card">
      <p className="eyebrow">{o.channel} · {o.from}</p>
      <h2 style={{ marginBottom: 6 }}>{o.itemName}</h2>
      <p className="muted small">{o.itemDescription}</p>
      {ev && (
        <p className="small">
          <b>{fmt(ev.estValueUsd)}</b> ({fmt(ev.valueLow)}–{fmt(ev.valueHigh)}) · {(ev.estValueUsd / cur).toFixed(2)}x · risk {(ev.risk * 100) | 0}% · story {(ev.story * 100) | 0}%<br />
          <span className="muted">{ev.reasoning}</span>
          {ev.policyFlags.length > 0 && <><br /><span style={{ color: "var(--warn)" }}>Flags: {ev.policyFlags.join(", ")}</span></>}
        </p>
      )}
      {o.photos.length > 0 && <p className="small">Photos: {o.photos.map((p, i) => <a key={i} href={p} target="_blank" rel="noreferrer">[{i + 1}] </a>)}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function WalletAdmin({ db, busy, act }: { db: any; busy: boolean; act: (b: Record<string, string>) => void }) {
  const t = db.treasury;
  if (!t) return null;
  const L = db.walletLimits || {};
  const payees: Record<string, string> = db.payees || {};
  const pending = (db.payouts || []).filter((p: any) => ["awaiting_approval", "failed", "needs_address", "sending"].includes(p.status)).reverse();
  return (
    <section style={{ marginTop: 24 }}>
      <h2>Wallet</h2>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        {!t.enabled && <p className="small" style={{ color: "var(--warn)", margin: 0 }}>Payments are switched off. Set WALLET_ENABLED=1 in .env to turn them on.</p>}
        <div className="small" style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          <span>Network <b>{t.network}</b></span>
          <span>Address <b className="mono">{t.address || "none – run npm run wallet -- create"}</b></span>
          <span>Balance <b>{t.balance ? `${t.balance.usdc.toFixed(2)} USDC · ${t.balance.sol.toFixed(4)} SOL` : "—"}</b></span>
          <span>Spent 24h <b>${t.spentToday} / ${t.dailyLimit}</b></span>
          <span style={{ marginLeft: "auto" }}>
            {t.paused
              ? <button disabled={busy} onClick={() => act({ action: "wallet_resume" })}>Resume payments</button>
              : <button className="ghost" disabled={busy} onClick={() => act({ action: "wallet_pause" })}>Pause all payments</button>}
          </span>
        </div>
        <div className="small muted">
          Auto-pay limits: ${L.perPayment} per payment · ${L.perDay} per day · ${L.perRecipientDay} per person per day · shipping ${L.shipping} · sweetener up to ${L.sweetenerMax} ({L.sweetenerPctOfItem}% of item) · tips ${L.tip} (max {L.tipsPerDay}/day)
        </div>
      </div>

      <h2 style={{ marginTop: 16 }}>Payments needing you</h2>
      {pending.length === 0 ? <p className="muted small">Nothing waiting.</p> : (
        <div className="grid">
          {pending.map((p: any) => (
            <div className="card" key={p.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px" }}>
                <b>${p.usd} {p.token}</b> · {p.purpose} → {p.toLabel || "?"} <span className="mono small muted">{p.to || "(no address yet)"}</span>
                <div className="small muted">{p.reason}{p.why ? ` · ${p.why}` : ""}</div>
              </div>
              {!["needs_address", "sending"].includes(p.status) && (
                <button
                  disabled={busy}
                  title={p.status === "failed" ? "Checks the blockchain for the earlier attempt first – it is never paid twice" : undefined}
                  onClick={() => confirm(`${p.status === "failed" ? "Retry" : "Send"} $${p.usd} ${p.token} to ${p.to}?`) && act({ action: "wallet_approve", payoutId: p.id })}
                >
                  {p.status === "failed" ? "Check & retry" : "Approve & send"}
                </button>
              )}
              {p.status === "sending" ? <span className="small muted">in flight – checked every round</span> : <button className="ghost" disabled={busy} onClick={() => act({ action: "wallet_reject", payoutId: p.id })}>Veto</button>}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 16 }}>Send a payment</h2>
      <form className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const to = String(f.get("to") || "");
          const usd = String(f.get("usd") || "");
          if (!confirm(`Send $${usd} to ${to}? This moves real money if the wallet is live.`)) return;
          act({ action: "wallet_manual", purpose: String(f.get("purpose")), to, usd, reason: String(f.get("reason") || ""), label: String(f.get("label") || "") });
          (e.target as HTMLFormElement).reset();
        }}>
        <select name="purpose" defaultValue="tip"><option value="tip">Tip / bounty (SOL)</option><option value="cost">Running cost (USDC, approved supplier)</option></select>
        <input name="to" list="payees" placeholder="Recipient Solana address" required style={{ flex: "2 1 260px", margin: 0 }} />
        <datalist id="payees">{Object.entries(payees).map(([n, a]) => <option key={n} value={a}>{n}</option>)}</datalist>
        <input name="label" placeholder="Who (e.g. @handle)" style={{ flex: "1 1 120px", margin: 0 }} />
        <input name="usd" type="number" step="0.01" min="0.01" placeholder="USD" required style={{ width: 100, margin: 0 }} />
        <input name="reason" placeholder="Reason" style={{ flex: "2 1 200px", margin: 0 }} />
        <button disabled={busy}>Send</button>
      </form>
    </section>
  );
}
