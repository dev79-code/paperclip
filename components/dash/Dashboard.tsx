"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, Item, LogEvent, Trade, WatchItem } from "@/lib/types";
import { OfferForm } from "@/components/OfferForm";
import { BrowserAgent } from "./BrowserAgent";
import { PortfolioChart } from "./PortfolioChart";
import { CountUp, mult, money, Spark } from "./ui";

interface State {
  mode: "demo" | "live";
  goalUsd: number;
  tickCount: number;
  lastTickAt?: string;
  currentItemId: string;
  items: Item[];
  trades: Trade[];
  venues: { id: string; name: string; channel: string; permission: string; stats: { posts: number; offers: number; accepted: number } }[];
  offers: { id: string; status: string; itemName: string; evaluation?: { estValueUsd: number; policyFlags: string[]; decision: string } }[];
  log: LogEvent[];
  activity: Activity[];
  watchlist: WatchItem[];
  history: { tick: number; at: string; value: number }[];
  postsCount: number;
  xHandle?: string;
}

function useLive(ms = 2500) {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const go = async () => {
      try {
        const r = await fetch("/api/state", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (alive) { setS(j); setErr(false); }
      } catch { if (alive) setErr(true); }
    };
    go();
    const t = setInterval(go, ms);
    return () => { alive = false; clearInterval(t); };
  }, [ms]);
  return { s, err };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const clock = (iso: string) => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

export function Dashboard() {
  const { s, err } = useLive();
  const [offerOpen, setOfferOpen] = useState(false);

  if (!s) {
    return (
      <div className="dash" style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
        <p className="empty">{err ? "Can't reach the agent. Retrying…" : "Loading the ledger…"}</p>
      </div>
    );
  }

  const cur = s.items.find((i) => i.id === s.currentItemId)!;
  const start = s.items[0];
  const lotNo = s.trades.length;
  const prevItem = lotNo ? s.items.find((i) => i.id === s.trades[lotNo - 1].fromItemId) : undefined;
  const totalMult = cur.estValueUsd / start.estValueUsd;
  const avgStep = lotNo ? Math.pow(totalMult, 1 / lotNo) : 2;
  const done = cur.estValueUsd >= s.goalUsd;
  const toGo = done ? 0 : Math.ceil(Math.log(s.goalUsd / cur.estValueUsd) / Math.log(Math.max(avgStep, 1.3)));
  const bestOffer = s.watchlist.filter((w) => w.kind === "offer").sort((a, b) => b.estValueUsd - a.estValueUsd)[0];
  const declined = s.offers.filter((o) => o.evaluation?.policyFlags.some((f) => /banned|cash|scam|risk/.test(f))).length;
  const tradeTicks = s.trades.map((t) => ({
    tick: s.history.find((h) => Date.parse(h.at) >= Date.parse(t.completedAt))?.tick ?? s.tickCount,
    name: s.items.find((i) => i.id === t.toItemId)?.name ?? "",
    mult: t.multiplier,
  }));
  const lastTrade = s.trades[lotNo - 1];
  const isNew = lastTrade && Date.now() - Date.parse(lastTrade.completedAt) < 20_000;

  return (
    <div className="dash">
      <Masthead s={s} err={err} onOffer={() => setOfferOpen(true)} />
      <Tape s={s} />

      {/* ------------------------------------------------ current lot */}
      <section className="row lot">
        <div className="c-7 lot-in" key={cur.id}>
          <div className="lot-meta">
            <span>Lot {pad2(lotNo)}</span>
            <span>{cur.category}</span>
            <span>{cur.acquiredFrom ? `from ${cur.acquiredFrom}` : "the starting item"}</span>
            {isNew && <span className="new">Just traded</span>}
            {done && <span className="new">Goal reached</span>}
          </div>
          <h1 className="lot-name">{cur.name}</h1>
          <p className="lot-desc">{cur.description}</p>
          <div className="lot-value">
            <span className="v"><CountUp value={cur.estValueUsd} duration={1400} /></span>
            <span className="est">
              Estimate <b>{money(cur.valueLow)} – {money(cur.valueHigh)}</b><br />
              {prevItem
                ? <span className={`chg ${cur.estValueUsd < prevItem.estValueUsd ? "neg" : ""}`}>{mult(cur.estValueUsd / prevItem.estValueUsd)} on {prevItem.name}</span>
                : <span className="muted">Where it all starts</span>}
            </span>
          </div>
        </div>
        <div className="c-5">
          <dl className="facts">
            <div className="fact"><dt>Return since the paperclip</dt><dd className="big" style={{ color: "var(--gain)" }}><CountUp value={totalMult} format={mult} /></dd></div>
            <div className="fact"><dt>Best offer on the table<small>{bestOffer ? bestOffer.name : "None yet, asking around"}</small></dt>
              <dd>{bestOffer ? <>{money(bestOffer.estValueUsd)}<span className="x">{mult(bestOffer.multiplier)}</span></> : "—"}</dd></div>
            <div className="fact"><dt>Trades so far<small>average step {avgStep.toFixed(2)}×</small></dt><dd>{lotNo}</dd></div>
            <div className="fact"><dt>Trades left at this pace</dt><dd>{done ? "0" : `~${toGo}`}</dd></div>
            <div className="fact"><dt>Offers received<small>{declined} turned down by the rules (scams, banned items, cash)</small></dt><dd>{s.offers.length}</dd></div>
            <div className="fact"><dt>Posts made<small>across {s.venues.filter((v) => v.stats.posts).length} communities</small></dt><dd>{s.postsCount}</dd></div>
          </dl>
        </div>
      </section>

      <Road items={s.items} trades={s.trades} cur={cur} goal={s.goalUsd} />

      {/* ------------------------------------------------ session + log */}
      <section className="row sec">
        <div className="c-8">
          <div className="sec-h"><span className="no">01</span><h2>What it's doing now</h2><span className="aside">replay of the agent's own actions</span></div>
          <BrowserAgent activity={s.activity} idle={done} />
        </div>
        <div className="c-4">
          <div className="sec-h"><span className="no">02</span><h2>Log</h2><span className="aside">{s.log.length} entries</span></div>
          <Log log={s.log} />
        </div>
      </section>

      {/* ------------------------------------------------ chart + watchlist */}
      <section className="row sec">
        <div className="c-7">
          <div className="sec-h"><span className="no">03</span><h2>Value held, round by round</h2></div>
          <PortfolioChart history={s.history} goal={s.goalUsd} trades={tradeTicks} />
        </div>
        <div className="c-5">
          <div className="sec-h"><span className="no">04</span><h2>Watchlist</h2><span className="aside">open offers & wanted</span></div>
          <Watchlist items={s.watchlist} />
        </div>
      </section>

      {/* ------------------------------------------------ provenance + channels */}
      <section className="row sec">
        <div className="c-8">
          <div className="sec-h"><span className="no">05</span><h2>Provenance</h2><span className="aside">every trade, in order</span></div>
          <Provenance items={s.items} trades={s.trades} cur={cur} />
        </div>
        <div className="c-4">
          <div className="sec-h"><span className="no">06</span><h2>Where it asks</h2></div>
          <Channels venues={s.venues} />
        </div>
      </section>

      <footer className="foot">
        <span>{s.mode === "demo" ? "Demo mode: the communities and the people replying are simulated." : "Live. Posts only where moderators have said yes, and every post says it's an AI."}</span>
        <span>Barter only · a human checks every item before a trade completes</span>
      </footer>

      {offerOpen && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setOfferOpen(false)}>
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2>Make an offer</h2>
              <button className="ghost" onClick={() => setOfferOpen(false)} aria-label="Close">Close</button>
            </div>
            <OfferForm holding={cur.name} />
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================ masthead + tape
function Masthead({ s, err, onOffer }: { s: State; err: boolean; onOffer: () => void }) {
  const [now, setNow] = useState("");
  useEffect(() => {
    const f = () => setNow(new Date().toLocaleTimeString("en-GB"));
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <header className="mast">
      <a className="mast-title" href="/">
        <svg width="26" height="34" viewBox="0 0 20 28" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 9V5.5a3.5 3.5 0 0 1 7 0V20a6 6 0 0 1-12 0V8" /><path d="M9.5 7v12.5a1.5 1.5 0 0 0 3 0V10" />
        </svg>
        Paperclip
      </a>
      <span className="mast-sub">one red paperclip, traded up to $100,000</span>
      <div className="mast-right">
        <span className={`mode ${s.mode === "live" ? "live" : ""}`}><i />{s.mode === "demo" ? "Demo" : "Live"}</span>
        <span>Round <b key={s.tickCount} className="num-tick">{s.tickCount}</b></span>
        <span suppressHydrationWarning>{now}</span>
        {err && <span style={{ color: "var(--warn)" }}>reconnecting</span>}
        {s.xHandle && <a href={`https://x.com/${s.xHandle}`} target="_blank" rel="noreferrer">@{s.xHandle}</a>}
        <a href="/admin">Custodian</a>
        <button onClick={onOffer}>Make an offer</button>
      </div>
    </header>
  );
}

function Tape({ s }: { s: State }) {
  const entries: React.ReactNode[] = [];
  [...s.trades].reverse().slice(0, 8).forEach((t) => {
    const a = s.items.find((i) => i.id === t.fromItemId), b = s.items.find((i) => i.id === t.toItemId);
    if (a && b) entries.push(<span key={t.id} className="tape-item"><span className="tr">LOT {pad2(t.number)}</span>&nbsp; {a.name} → <b>{b.name}</b>&nbsp; <span className="up">{mult(t.multiplier)}</span></span>);
  });
  s.watchlist.filter((w) => w.kind === "offer").forEach((w) => entries.push(
    <span key={w.id} className="tape-item">OFFER&nbsp; <b>{w.name}</b>&nbsp; {money(w.estValueUsd)}&nbsp; <span className="up">{mult(w.multiplier)}</span></span>,
  ));
  if (entries.length < 2) return <div className="tape" style={{ height: 36 }} />;
  return (
    <div className="tape" aria-label="Recent trades and offers">
      <div className="tape-track">{entries}{entries.map((e, i) => <span key={"d" + i} aria-hidden style={{ display: "contents" }}>{e}</span>)}</div>
    </div>
  );
}

// ================================================================ road ruler (log scale)
function Road({ items, trades, cur, goal }: { items: Item[]; trades: Trade[]; cur: Item; goal: number }) {
  const W = 1000, H = 92, P = 8, Y = 58;
  const lo = -2, hi = Math.log10(goal);
  const x = (v: number) => P + ((Math.log10(Math.max(v, 0.01)) - lo) / (hi - lo)) * (W - 2 * P);
  const lots = [items[0], ...trades.map((t) => items.find((i) => i.id === t.toItemId)!)].filter(Boolean);
  const decades = [0.01, 0.1, 1, 10, 100, 1000, 10000, 100000];
  const label = (v: number) => (v < 1 ? `$${v}` : v >= 1000 ? `$${v / 1000}k` : `$${v}`);
  // only number lots whose dots are far enough apart
  let lastX = -99;
  const numbered = lots.map((it) => { const px = x(it.estValueUsd); const ok = px - lastX > 16; if (ok) lastX = px; return ok; });
  const cx = Math.min(x(cur.estValueUsd), W - P);
  return (
    <section className="road">
      <div className="sec-h" style={{ marginBottom: 6 }}><span className="no">00</span><h2>The road to {money(goal)}</h2><span className="aside">log scale · each mark is one trade</span></div>
      <div className="road-scroll"><svg className="road-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Progress from $0.01 to ${money(goal)} on a log scale`}>
        {decades.map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={Y - 8} y2={Y + 8} stroke="var(--ink-3)" />
            <text x={x(d)} y={Y + 26} textAnchor={d === decades[0] ? "start" : d === goal ? "end" : "middle"} fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">{label(d)}</text>
            {d < goal && [2, 3, 4, 5, 6, 7, 8, 9].map((m) => <line key={m} x1={x(d * m)} x2={x(d * m)} y1={Y - 3} y2={Y + 3} stroke="var(--line-2)" />)}
          </g>
        ))}
        <line x1={P} x2={W - P} y1={Y} y2={Y} stroke="var(--line-2)" />
        <line x1={P} x2={cx} y1={Y} y2={Y} stroke="var(--ink)" strokeWidth="2" style={{ transition: "all 1.2s cubic-bezier(.2,.7,.2,1)" }} />
        {lots.map((it, i) => it.id !== cur.id && (
          <g key={it.id}>
            <circle cx={x(it.estValueUsd)} cy={Y} r="3.2" fill="var(--bg)" stroke="var(--ink)" strokeWidth="1.5" />
            {numbered[i] && <text x={x(it.estValueUsd)} y={Y - 12} textAnchor="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--mono)">{i}</text>}
          </g>
        ))}
        <g style={{ transition: "transform 1.2s cubic-bezier(.2,.7,.2,1)", transform: `translateX(${cx}px)` }}>
          <line x1="0" x2="0" y1={Y - 30} y2={Y} stroke="var(--accent)" />
          <circle cx="0" cy={Y} r="5.5" fill="var(--accent)" />
          <text x={cx > W - 160 ? -8 : 8} y={Y - 22} textAnchor={cx > W - 160 ? "end" : "start"} fontSize="12" fill="var(--ink)" fontFamily="var(--mono)">
            Lot {pad2(lots.length - 1)} · {money(cur.estValueUsd)}
          </text>
        </g>
      </svg></div>
    </section>
  );
}

// ================================================================ log
function Log({ log }: { log: LogEvent[] }) {
  const seen = useRef<Set<string> | null>(null);
  const items = log.slice(-60).reverse();
  const fresh = new Set<string>();
  if (seen.current) items.forEach((e) => !seen.current!.has(e.id) && fresh.add(e.id));
  useEffect(() => { seen.current = new Set(log.map((e) => e.id)); }, [log]);
  const name: Record<string, string> = { think: "plan", post: "posted", offer: "offer in", evaluate: "valued", reply: "replied", trade: "trade", policy: "rule", error: "error", system: "note" };
  return (
    <ul className="log">
      {items.map((e) => (
        <li key={e.id} className={`${e.kind} ${fresh.has(e.id) ? "fresh" : ""}`}>
          <span className="t" suppressHydrationWarning>{clock(e.at)}</span>
          <span><span className="k">{name[e.kind] ?? e.kind}</span>{e.text.replace(/^→ /, "To ")}</span>
        </li>
      ))}
    </ul>
  );
}

// ================================================================ watchlist
function Watchlist({ items }: { items: WatchItem[] }) {
  const prev = useRef<Map<string, number>>(new Map());
  const dir = new Map<string, "up" | "down">();
  items.forEach((w) => {
    const p = prev.current.get(w.id);
    if (p != null && Math.abs(p - w.estValueUsd) > 1e-6) dir.set(w.id, w.estValueUsd > p ? "up" : "down");
  });
  useEffect(() => { prev.current = new Map(items.map((w) => [w.id, w.estValueUsd])); }, [items]);
  if (!items.length) return <p className="empty">Nothing on the list yet. The agent is still posting.</p>;
  return (
    <table className="tbl">
      <thead><tr><th>Item</th><th className="hide-sm">Trend</th><th className="r">Est.</th><th className="r">×</th></tr></thead>
      <tbody>
        {items.slice(0, 8).map((w) => {
          const d = dir.get(w.id);
          const trend = w.history.length > 1 ? w.history[w.history.length - 1] - w.history[0] : 0;
          const status = w.status === "awaiting_approval" ? <span className="tag hot">needs approval</span>
            : w.status === "accepted" ? <span className="tag ok">accepted · shipping</span>
            : w.kind === "target" ? <span className="tag">wanted</span> : <span className="tag">offer · {w.from}</span>;
          return (
            <tr key={w.id + (d ? w.estValueUsd : "")} className={d ?? ""}>
              <td className="nm" title={w.name}>{w.name}<span className="sub">{status}</span></td>
              <td className="hide-sm" style={{ width: 90 }}><Spark data={w.history} w={84} h={22} fill={false} color={trend > 0 ? "var(--gain)" : trend < 0 ? "var(--accent)" : "var(--ink-3)"} /></td>
              <td className="r n">{money(w.estValueUsd)}</td>
              <td className={`r n x ${w.multiplier < 1.5 ? "low" : ""}`}>{mult(w.multiplier)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ================================================================ provenance
function Provenance({ items, trades, cur }: { items: Item[]; trades: Trade[]; cur: Item }) {
  const rows = useMemo(() => [{ it: items[0], t: undefined as Trade | undefined }, ...trades.map((t) => ({ it: items.find((i) => i.id === t.toItemId)!, t }))].reverse(), [items, trades]);
  return (
    <div className="scroll-x" style={{ maxHeight: 420, overflowY: "auto" }}>
      <table className="tbl">
        <thead><tr><th>Lot</th><th>Item</th><th className="hide-sm">Via</th><th className="r">Value</th><th className="r">×</th></tr></thead>
        <tbody>
          {rows.map(({ it, t }, i) => (
            <tr key={it.id} className={it.id === cur.id ? "cur" : ""}>
              <td className="n" style={{ color: "var(--ink-3)", width: 48 }}>{pad2(rows.length - 1 - i)}</td>
              <td className="nm" title={it.name}>{it.name}<span className="sub">{t ? `from ${t.counterparty}` : "the beginning"}</span></td>
              <td className="hide-sm n" style={{ color: "var(--ink-3)" }}>{t?.channel ?? "—"}</td>
              <td className="r n">{money(it.estValueUsd)}</td>
              <td className="r n x">{t ? mult(t.multiplier) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ================================================================ channels
function Channels({ venues }: { venues: State["venues"] }) {
  const max = Math.max(1, ...venues.map((v) => v.stats.offers));
  return (
    <>
      <table className="tbl">
        <thead><tr><th>Community</th><th className="r">Posts</th><th className="r">Offers</th><th className="bar-cell" /></tr></thead>
        <tbody>
          {[...venues].sort((a, b) => b.stats.offers - a.stats.offers).map((v) => {
            const ok = v.permission === "granted" || v.permission === "not_required";
            return (
              <tr key={v.id}>
                <td className="nm" title={v.name}><span className="perm" style={{ background: ok ? "var(--gain)" : v.permission === "denied" ? "var(--bad)" : "var(--warn)" }} />{v.name.replace(/ \(own account\)| \(Discourse\)| \(email\)/, "")}</td>
                <td className="r n">{v.stats.posts}</td>
                <td className="r n">{v.stats.offers}</td>
                <td className="bar-cell"><div className="hbar"><i style={{ width: `${(v.stats.offers / max) * 100}%` }} /></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small" style={{ color: "var(--ink-3)", marginTop: 12 }}>
        <span className="perm" style={{ background: "var(--gain)" }} />allowed to post
        <span className="perm" style={{ background: "var(--warn)", marginLeft: 14 }} />waiting on moderators
      </p>
    </>
  );
}
