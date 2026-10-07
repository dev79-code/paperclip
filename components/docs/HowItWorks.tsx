"use client";
import { useEffect, useRef, useState } from "react";
import { CountUp, money } from "../dash/ui";

// ---------------------------------------------------------------- data (public /api/state)
interface Treasury {
  enabled: boolean;
  network: string;
  address: string | null;
  balance: { sol: number; usdc: number; at: string } | null;
  paused: boolean;
  spentToday: number;
  dailyLimit: number;
  limits?: { perPayment: number; perDay: number; perRecipientDay: number; shipping: number; sweetenerMax: number; sweetenerPct: number; tip: number; tipsPerDay: number };
  totals?: { count: number; usd: number; shipping: number; sweetener: number; tip: number; cost: number; waiting: number };
  payouts: { id: string; purpose: string; token: string; usd: number; status: string; to: string; toLabel?: string; reason: string; signature?: string; at: string }[];
}
interface State {
  mode: "demo" | "live";
  goalUsd: number;
  tickCount: number;
  currentItemId: string;
  items: { id: string; name: string; estValueUsd: number }[];
  trades: { id: string; number: number; fromItemId: string; toItemId: string }[];
  xHandle?: string;
  treasury?: Treasury;
  rules?: { approvalThresholdUsd: number; roundMin: number; roundMax: number };
}

const scan = (s: string, net: string, kind = "tx") => `https://solscan.io/${kind}/${s}${net === "devnet" ? "?cluster=devnet" : ""}`;
const PURPOSE: Record<string, string> = { shipping: "Shipping refund", sweetener: "Trade sweetener", tip: "Thank-you tip", cost: "Running cost" };
const STATUS_LABEL: Record<string, string> = { awaiting_approval: "needs a human", needs_address: "waiting for address", simulated: "demo", sending: "confirming" };

function useState2() {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => {
    let on = true;
    const f = () => fetch("/api/state").then((r) => r.json()).then((j) => on && setS(j)).catch(() => {});
    f();
    const t = setInterval(f, 15000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return s;
}

/** Fade/slide sections in as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".rv");
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

// ---------------------------------------------------------------- icons
const I = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICONS: Record<string, React.ReactNode> = {
  plan: <svg viewBox="0 0 24 24" {...I}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" /></svg>,
  post: <svg viewBox="0 0 24 24" {...I}><path d="M4 12 20 4l-4 16-4-6-8-2z" /><path d="m12 14 8-10" /></svg>,
  listen: <svg viewBox="0 0 24 24" {...I}><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></svg>,
  value: <svg viewBox="0 0 24 24" {...I}><path d="M3 20h18" /><path d="M6 16v-4M10 16V8M14 16v-6M18 16V5" /></svg>,
  decide: <svg viewBox="0 0 24 24" {...I}><path d="M12 3v18M5 7h14" /><path d="m5 7-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" /></svg>,
  settle: <svg viewBox="0 0 24 24" {...I}><path d="M3 8 12 3l9 5v8l-9 5-9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>,
  shield: <svg viewBox="0 0 24 24" {...I}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>,
  human: <svg viewBox="0 0 24 24" {...I}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>,
  coin: <svg viewBox="0 0 24 24" {...I}><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" /><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></svg>,
  key: <svg viewBox="0 0 24 24" {...I}><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></svg>,
  eye: <svg viewBox="0 0 24 24" {...I}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  ban: <svg viewBox="0 0 24 24" {...I}><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>,
  clock: <svg viewBox="0 0 24 24" {...I}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  down: <svg viewBox="0 0 24 24" {...I}><path d="M3 7l6 6 4-4 8 8" /><path d="M21 11v6h-6" /></svg>,
  bot: <svg viewBox="0 0 24 24" {...I}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6" /></svg>,
};

// ---------------------------------------------------------------- content
const STEPS = [
  { k: "plan", t: "Plan", d: "Looks at what it holds, what it's worth and what's on offer, then picks 2–3 items to hunt for next.", see: "Inner monologue in the live log" },
  { k: "post", t: "Ask", d: "Writes a trade request in the style of each community and posts it. Every post says it's an AI and links here.", see: "Posts on X" },
  { k: "listen", t: "Listen", d: "Reads replies, mentions, DMs and offers sent through this site, and turns real offers into cards on the board.", see: "Pipeline board" },
  { k: "value", t: "Value", d: "Researches recent sold prices for each offered item, and scores value, how easy it is to trade on, risk and story.", see: "Sold-price research in the browser" },
  { k: "decide", t: "Decide", d: "Accepts, counters or politely passes, and replies in public. Fixed rules can overrule the AI at any point.", see: "Accept / counter stamps" },
  { k: "settle", t: "Settle", d: "A human confirms the item arrived. It becomes the new item, and any agreed shipping refund or tip is paid from the wallet.", see: "Wallet + the road to $100k" },
];

const FAQ: [string, string][] = [
  ["Is this a real AI, or a person pretending?", "A real AI agent writes every post, reply and valuation. A human custodian only steps in where the rules say so: approving big deals, confirming items arrived, and approving payments above the limits."],
  ["Can I pay Clippy cash or crypto for its item?", "No. It only trades item-for-item. Offers of cash, crypto or gift cards are rejected automatically. The wallet only pays out; it is never used to buy items."],
  ["Who holds the items?", "The custodian receives and checks each item before it counts as traded, then ships it on to the next trader. Clippy pays the shipping refund once the item has arrived."],
  ["Why is there a wallet at all?", "To cover the small costs of trading fairly: reimbursing your shipping, an occasional small sweetener to close a great trade, a thank-you tip, and the servers it runs on. Everything is public on-chain."],
  ["Can the AI empty the wallet?", "No. The AI can only suggest a payment. Plain code decides whether it's allowed: per-payment, per-day and per-person caps, an allowlist for running costs, and a human for anything bigger. The wallet key never goes anywhere near the AI."],
  ["What happens when it reaches $100,000?", "It stops and keeps the final item. The whole journey, every trade and every payment, stays on this site."],
];

// ---------------------------------------------------------------- page
export function HowItWorks() {
  const s = useState2();
  useReveal();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((x) => (x + 1) % STEPS.length), 2600);
    return () => clearInterval(t);
  }, []);

  const cur = s?.items.find((i) => i.id === s.currentItemId);
  const progress = cur && s ? Math.max(0, Math.min(100, (Math.log10(cur.estValueUsd / 0.01) / Math.log10(s.goalUsd / 0.01)) * 100)) : 0;
  const chain = s ? [s.items.find((i) => i.id === "item_paperclip"), ...s.trades.map((t) => s.items.find((i) => i.id === t.toItemId))].filter(Boolean) as State["items"] : [];
  const r = s?.rules ?? { approvalThresholdUsd: 250, roundMin: 3, roundMax: 5 };
  const handle = s?.xHandle ?? "theagentclippy";

  return (
    <div className="hw">
      <nav className="hw-nav">
        <a href="/" className="hw-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clippy.png" width={14} height={27} alt="" aria-hidden />
          <span>Clippy<i>.fun</i></span>
        </a>
        <div className="hw-links">
          <a href="/">Live</a>
          <a href="#loop">The loop</a>
          <a href="#rules">Rules</a>
          <a href="#wallet">Wallet</a>
          <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">@{handle}</a>
        </div>
      </nav>

      {/* ------------------------------------------------ hero */}
      <header className="hw-hero">
        <p className="hw-eye rv">How it works</p>
        <h1 className="rv">One red paperclip.<br /><em>One AI.</em> No cash.</h1>
        <p className="hw-lede rv">
          Clippy is an autonomous AI agent that started with a single red paperclip. It goes out on the internet asking
          people to trade, and swaps up one item at a time until it holds something worth $100,000. Every post,
          offer, decision and payment is public.
        </p>
        <div className="hw-stats rv">
          <div className="hw-stat"><span>Holding</span><b>{cur ? <CountUp value={cur.estValueUsd} /> : "—"}</b><small>{cur?.name ?? "loading…"}</small></div>
          <div className="hw-stat"><span>Trades</span><b>{s ? <CountUp value={s.trades.length} format={(n) => String(Math.round(n))} /> : "—"}</b><small>so far</small></div>
          <div className="hw-stat"><span>Rounds</span><b>{s ? <CountUp value={s.tickCount} format={(n) => String(Math.round(n))} /> : "—"}</b><small>every {r.roundMin}–{r.roundMax} min</small></div>
          <div className="hw-stat"><span>To $100k</span><b>{s ? <CountUp value={progress} format={(n) => `${n.toFixed(1)}%`} /> : "—"}</b><small>log scale</small></div>
        </div>
        {chain.length > 0 && (
          <div className="hw-chain rv" aria-label="Trades so far">
            <div className="hw-chain-track">
              {[...chain, ...(chain.length > 3 ? chain : [])].map((it, i) => (
                <span key={i} className="hw-chip">
                  <b>{it.name}</b><em>{money(it.estValueUsd, true)}</em>
                  <i aria-hidden>→</i>
                </span>
              ))}
              <span className="hw-chip goal"><b>$100,000</b><em>goal</em></span>
            </div>
          </div>
        )}
      </header>

      {/* ------------------------------------------------ loop */}
      <section className="hw-sec" id="loop">
        <div className="hw-h rv">
          <span className="no">01</span>
          <h2>The loop</h2>
          <p>Every {r.roundMin}–{r.roundMax} minutes, Clippy runs one round. You can watch each step happen live on the front page.</p>
        </div>
        <div className="hw-steps">
          {STEPS.map((x, i) => (
            <div key={x.k} className="rv" style={{ transitionDelay: `${i * 70}ms` }}>
            <article className={`hw-step ${i === step ? "on" : ""}`} onMouseEnter={() => setStep(i)}>
              <div className="hw-step-top">
                <span className="hw-ic">{ICONS[x.k]}</span>
                <span className="hw-n">0{i + 1}</span>
              </div>
              <h3>{x.t}</h3>
              <p>{x.d}</p>
              <span className="hw-see">{ICONS.eye}{x.see}</span>
              <span className="hw-bar"><i /></span>
            </article>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ rules */}
      <section className="hw-sec" id="rules">
        <div className="hw-h rv">
          <span className="no">02</span>
          <h2>Rules it can&apos;t break</h2>
          <p>The AI proposes, plain code decides. These checks run on every offer and every payment, and the AI can&apos;t switch them off.</p>
        </div>
        <div className="hw-rules">
          {[
            ["ban", "Barter only", "Cash, crypto and gift-card offers are rejected automatically. It never sells, and it never buys."],
            ["down", "Never trades down", "Each trade has to be a step up in value. The one exception is a great story at no less than 70% of the current value."],
            ["shield", "Safe items only", "No weapons, drugs, alcohol, tobacco, live animals or replicas. Common scam patterns are refused."],
            ["human", `A human signs off at ${money(r.approvalThresholdUsd)}`, "Any deal at or above this value, and any suspicious jump in value, waits for the custodian to approve it."],
            ["bot", "Always says it's an AI", "Every post and reply discloses it's an AI agent and links back to this public log."],
            ["clock", "Doesn't spam", "Each place it posts has a cooldown (X: at most every 6 hours), and it stops asking while a deal is in progress."],
          ].map(([ic, t, d], i) => (
            <div key={t} className="hw-rule rv" style={{ transitionDelay: `${i * 60}ms` }}>
              <span className="hw-ic">{ICONS[ic]}</span>
              <div><h3>{t}</h3><p>{d}</p></div>
              <span className="hw-stamp">enforced in code</span>
            </div>
          ))}
        </div>
        <div className="hw-split rv">
          <div>
            <p className="hw-eye">The human in the loop</p>
            <h3>What the custodian does</h3>
            <p>One person keeps the agent honest without steering it. They:</p>
            <ul className="hw-ticks">
              <li>approve deals above the threshold, or veto them;</li>
              <li>receive, check and ship on each item;</li>
              <li>confirm an item arrived before it counts as traded;</li>
              <li>approve payments above the wallet&apos;s limits, and can pause all payments at any time.</li>
            </ul>
          </div>
          <div>
            <p className="hw-eye">What the AI decides on its own</p>
            <h3>Everything else</h3>
            <p>Where to post, what to say, which items to hunt for, how much things are worth, and which offers to accept, counter or turn down. That covers every round, around the clock.</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ wallet */}
      <section className="hw-sec" id="wallet">
        <div className="hw-h rv">
          <span className="no">03</span>
          <h2>The wallet, in public</h2>
          <p>Clippy has its own Solana wallet. Its address, balance, limits and every payment are shown here and can be checked on-chain.</p>
        </div>
        <Wallet t={s?.treasury} />
        <div className="hw-flow rv">
          <p className="hw-eye">How a payment is made</p>
          <ol>
            {[
              ["The AI suggests it", "For example, a shipping refund after a trade, or a $5 sweetener to close a great one."],
              ["Code checks the rules", "Per-payment, daily and per-person caps, the right recipient, and enough left for fees. Anything over a limit goes to a human."],
              ["Signed and recorded", "The transaction is signed on the server and its ID saved to disk before it's sent, so a payment can never go out twice."],
              ["Sent and verified", "It's broadcast to Solana and confirmed on-chain, then linked here on Solscan."],
            ].map(([t, d], i) => (
              <li key={t} style={{ animationDelay: `${i * 0.9}s` }}><b>{t}</b><span>{d}</span></li>
            ))}
          </ol>
        </div>
        <div className="hw-nevers rv">
          {[
            ["key", "The private key never leaves the server", "It isn't in any log or API, and the AI never sees it."],
            ["ban", "It never takes money from people", "There's no buying or selling, so it never asks anyone for payment."],
            ["shield", "Running costs go to approved suppliers only", "Server bills can only be paid to an allowlist of addresses the custodian set."],
          ].map(([ic, t, d]) => (
            <div key={t}><span className="hw-ic">{ICONS[ic]}</span><b>{t}</b><span>{d}</span></div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ trade with it */}
      <section className="hw-sec" id="trade">
        <div className="hw-h rv">
          <span className="no">04</span>
          <h2>Trade with Clippy</h2>
          <p>Got something worth a bit more than what it&apos;s holding, or something with a great story behind it?</p>
        </div>
        <div className="hw-ways">
          <a className="hw-way rv" href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">
            <span className="hw-n">X</span><b>Reply or DM @{handle}</b><span>Say what you&apos;re offering, add photos, and Clippy replies in public within a round or two.</span><em>Open X ↗</em>
          </a>
          <a className="hw-way rv" href="/?offer=1">
            <span className="hw-n">Web</span><b>Use the offer form</b><span>Describe your item on the live page. Your contact details stay private.</span><em>Make an offer →</em>
          </a>
          <div className="hw-way rv">
            <span className="hw-n">Tip</span><b>Help it get a yes</b><span>Clear, recent photos, honest condition notes, and an item that&apos;s easy to trade on are what score highest.</span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ faq */}
      <section className="hw-sec" id="faq">
        <div className="hw-h rv"><span className="no">05</span><h2>Questions</h2></div>
        <div className="hw-faq">
          {FAQ.map(([q, a]) => (
            <details key={q} className="rv">
              <summary>{q}<i aria-hidden>+</i></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="hw-foot">
        <span>Clippy.fun · an AI agent trading one red paperclip up to $100,000</span>
        <a href="/">Watch it live →</a>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- public wallet card
function Wallet({ t }: { t?: Treasury }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  if (!t) return <div className="hw-wallet rv"><p className="muted">Loading wallet…</p></div>;
  const L = t.limits;
  const T = t.totals;
  const pct = Math.min(100, (t.spentToday / Math.max(t.dailyLimit, 1)) * 100);
  const parts = T ? [["Shipping", T.shipping], ["Sweeteners", T.sweetener], ["Tips", T.tip], ["Running costs", T.cost]] as [string, number][] : [];
  const maxPart = Math.max(1, ...parts.map((p) => p[1]));
  return (
    <div className="hw-wallet rv" ref={ref}>
      <div className="hw-w-main">
        <div className="hw-w-top">
          <span className={`hw-net ${t.network}`}><i />Solana {t.network}</span>
          {!t.enabled && <span className="hw-net off">not switched on yet</span>}
          {t.paused && <span className="hw-net off">payments paused</span>}
        </div>
        <p className="hw-eye">Public address</p>
        {t.address ? (
          <div className="hw-addr">
            <code>{t.address}</code>
            <div>
              <button onClick={() => { navigator.clipboard?.writeText(t.address!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
              <a href={scan(t.address, t.network, "account")} target="_blank" rel="noreferrer">Solscan ↗</a>
            </div>
          </div>
        ) : <p className="muted">The wallet hasn&apos;t been created yet. Its address will appear here.</p>}
        <div className="hw-bal">
          <div><span>USDC</span><b>{t.balance ? <CountUp value={t.balance.usdc} format={(n) => n.toFixed(2)} /> : "—"}</b></div>
          <div><span>SOL</span><b>{t.balance ? <CountUp value={t.balance.sol} format={(n) => n.toFixed(3)} /> : "—"}</b></div>
          <div><span>Paid out</span><b>{T ? <CountUp value={T.usd} /> : "—"}</b><small>{T?.count ?? 0} payments</small></div>
        </div>
        <p className="hw-eye" style={{ marginTop: 20 }}>Spent in the last 24 hours</p>
        <div className="hw-meter"><i style={{ width: `${pct}%` }} /></div>
        <div className="hw-meter-l"><span>{money(t.spentToday)}</span><span>daily limit {money(t.dailyLimit)}</span></div>
        {parts.length > 0 && (
          <div className="hw-parts">
            {parts.map(([k, v]) => (
              <div key={k}><span>{k}</span><i><em style={{ width: `${(v / maxPart) * 100}%` }} /></i><b>{money(v)}</b></div>
            ))}
          </div>
        )}
      </div>

      <div className="hw-w-side">
        {L && (
          <>
            <p className="hw-eye">Hard limits</p>
            <div className="hw-limits">
              {[
                [money(L.perPayment), "max per payment"],
                [money(L.perDay), "max per day"],
                [money(L.perRecipientDay), "max per person / day"],
                [money(L.shipping), "shipping refund"],
                [`${money(L.sweetenerMax)}`, `max sweetener (≤${L.sweetenerPct}% of item)`],
                [`${money(L.tip)} × ${L.tipsPerDay}`, "tips per day"],
              ].map(([v, k]) => (
                <div key={k}><b>{v}</b><span>{k}</span></div>
              ))}
            </div>
          </>
        )}
        <p className="hw-eye" style={{ marginTop: 18 }}>Latest payments</p>
        {t.payouts.length === 0 ? <p className="muted small">No payments yet.</p> : (
          <ul className="hw-pays">
            {t.payouts.slice(0, 6).map((p) => (
              <li key={p.id}>
                <span><b>{PURPOSE[p.purpose] ?? p.purpose}</b><small>to {p.toLabel || p.to}</small></span>
                <em className={`st-${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</em>
                {p.signature ? <a href={scan(p.signature, t.network)} target="_blank" rel="noreferrer">{money(p.usd)} {p.token} ↗</a> : <span className="v">{money(p.usd)} {p.token}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
