"use client";
import type { WatchItem } from "@/lib/types";
import { CatIcon, CountUp, mult, money, Spark } from "./ui";

export interface PipeOffer {
  id: string;
  itemName: string;
  from: string;
  channel: string;
  status: string;
  createdAt: string;
  photos?: string[];
  sourceUrl?: string;
  postUrl?: string;
  evaluation?: { estValueUsd: number; category?: string; decision: string; policyFlags: string[] };
}

interface Card {
  id: string;
  name: string;
  category?: string;
  value?: number;
  from?: string;
  channel?: string;
  at?: string;
  photo?: string;
  history: number[];
  links: { label: string; href: string }[];
  flag?: string;
}

const COLS: { key: string; title: string; hint: string }[] = [
  { key: "wanted", title: "Wanted", hint: "what Clippy is hoping for" },
  { key: "valuing", title: "Valuing", hint: "just came in" },
  { key: "table", title: "On the table", hint: "valued, worth considering" },
  { key: "approval", title: "Needs approval", hint: "waiting for a human" },
  { key: "accepted", title: "Accepted", hint: "agreed · shipping" },
];

const ago = (iso?: string) => {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const soldSearch = (q: string) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;

export function Pipeline({ offers, watchlist, current }: { offers: PipeOffer[]; watchlist: WatchItem[]; current: number }) {
  const hist = new Map(watchlist.map((w) => [w.id, w.history]));
  const cols: Record<string, Card[]> = { wanted: [], valuing: [], table: [], approval: [], accepted: [] };

  for (const w of watchlist.filter((w) => w.kind === "target")) {
    cols.wanted.push({
      id: w.id, name: w.name, category: w.category, value: w.estValueUsd, history: w.history,
      links: [{ label: "Sold prices", href: soldSearch(w.name) }],
    });
  }
  for (const o of offers) {
    const col = o.status === "new" ? "valuing" : ["evaluated", "countered"].includes(o.status) ? "table" : o.status === "awaiting_approval" ? "approval" : o.status === "accepted" ? "accepted" : null;
    if (!col) continue;
    const links: Card["links"] = [];
    if (o.sourceUrl) links.push({ label: "Offer", href: o.sourceUrl });
    if (o.postUrl) links.push({ label: "Clippy's post", href: o.postUrl });
    links.push({ label: "Sold prices", href: soldSearch(o.itemName) });
    cols[col].push({
      id: o.id, name: o.itemName, category: o.evaluation?.category, value: o.evaluation?.estValueUsd,
      from: o.from, channel: o.channel, at: o.createdAt, photo: o.photos?.[0],
      history: hist.get("w_" + o.id) ?? (o.evaluation ? [o.evaluation.estValueUsd] : []),
      links, flag: o.status === "countered" ? "countered" : undefined,
    });
  }
  for (const k of Object.keys(cols)) cols[k].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const live = [...cols.table, ...cols.approval, ...cols.accepted];
  const pipeValue = live.reduce((s, c) => s + (c.value ?? 0), 0);
  const best = live.reduce<Card | null>((m, c) => (!m || (c.value ?? 0) > (m.value ?? 0) ? c : m), null);

  return (
    <section className="pipe">
      <div className="sec-h">
        <span className="no">01</span>
        <h2>Pipeline</h2>
        <span className="aside">every item in play · links go to the real posts</span>
      </div>

      <div className="pipe-sum">
        <div><span>Offers in play</span><b><CountUp value={live.length + cols.valuing.length} format={(n) => Math.round(n).toString()} duration={600} /></b></div>
        <div><span>Pipeline value</span><b><CountUp value={pipeValue} /></b></div>
        <div><span>Best step up</span><b>{best?.value ? <>{mult(best.value / current)}<em> · {best.name}</em></> : "—"}</b></div>
        <div><span>Holding now</span><b>{money(current)}</b></div>
      </div>

      <div className="pipe-board">
        {COLS.map((c) => (
          <div className={`pcol pcol-${c.key}`} key={c.key}>
            <div className="pcol-h">
              <span className="pcol-t">{c.title}</span>
              <span className="pcol-n">{cols[c.key].length}</span>
            </div>
            <div className="pcol-hint">{c.hint}</div>
            <div className="pcol-body">
              {cols[c.key].length === 0 && <div className="pcard-empty">—</div>}
              {cols[c.key].slice(0, 8).map((card, i) => {
                const m = card.value != null ? card.value / current : undefined;
                const trend = card.history.length > 1 ? card.history[card.history.length - 1] - card.history[0] : 0;
                return (
                  <article className="pcard" key={card.id} style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="pcard-top">
                      <span className="pcard-thumb">
                        {card.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={card.photo} alt="" />
                        ) : (
                          <CatIcon c={card.category} size={20} />
                        )}
                      </span>
                      <span className="pcard-name">
                        <b title={card.name}>{card.name}</b>
                        <small>{card.from ? `${card.from} · ${card.channel}` : "wishlist"}{card.at ? ` · ${ago(card.at)}` : ""}</small>
                      </span>
                    </div>
                    <div className="pcard-mid">
                      <span className="pcard-v">{card.value != null ? money(card.value) : <span className="pulse-text">valuing…</span>}</span>
                      {m != null && <span className={`pcard-x ${m >= 1.5 ? "" : "low"}`}>{mult(m)}</span>}
                      {card.flag && <span className="pcard-flag">{card.flag}</span>}
                    </div>
                    {card.history.length > 1 && (
                      <div className="pcard-spark"><Spark data={card.history} w={200} h={24} fill={false} color={trend > 0 ? "var(--gain)" : trend < 0 ? "var(--accent)" : "var(--ink-3)"} /></div>
                    )}
                    <div className="pcard-links">
                      {card.links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noreferrer">{l.label} ↗</a>)}
                    </div>
                  </article>
                );
              })}
              {cols[c.key].length > 8 && <div className="pcard-more">+{cols[c.key].length - 8} more</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
