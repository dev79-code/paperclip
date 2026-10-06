"use client";
import { useEffect, useRef, useState } from "react";
import type { Item } from "@/lib/types";
import { CatIcon, CountUp, mult, money } from "./ui";

export interface LotOffer {
  id: string;
  itemName: string;
  from: string;
  channel: string;
  status: string;
  createdAt: string;
  photos?: string[];
  evaluation?: { estValueUsd: number; decision: string; policyFlags: string[] };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "valuing", cls: "st-new" },
  evaluated: { label: "on the table", cls: "st-good" },
  countered: { label: "countered", cls: "st-warn" },
  awaiting_approval: { label: "needs approval", cls: "st-warn" },
  accepted: { label: "accepted · shipping", cls: "st-good" },
  completed: { label: "traded", cls: "st-good" },
  rejected: { label: "declined", cls: "st-bad" },
  expired: { label: "expired", cls: "st-dim" },
};

function held(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

/** Big photo of the item, or – until someone adds one – an animated line illustration. */
function ItemVisual({ item, lotNo }: { item: Item; lotNo: number }) {
  const [broken, setBroken] = useState(false);
  const isClip = /paperclip/i.test(item.name);
  return (
    <div className="iv" key={item.id}>
      {item.imageUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="iv-photo" src={item.imageUrl} alt={item.name} onError={() => setBroken(true)} />
      ) : (
        <div className="iv-art" aria-hidden>
          <div className="iv-spot" />
          <div className="iv-ring" />
          {isClip ? (
            <svg className="iv-draw" viewBox="0 0 120 200" width="46%">
              <path d="M38 70V36a22 22 0 0 1 44 0v116a32 32 0 0 1-64 0V58" />
              <path d="M58 52v94a10 10 0 0 0 20 0V64" />
            </svg>
          ) : (
            <span className="iv-draw iv-icon"><CatIcon c={item.category} size={180} /></span>
          )}
        </div>
      )}
      <div className="iv-tag"><span>Lot {pad2(lotNo)}</span><span>{item.category}</span></div>
      {!item.imageUrl && <div className="iv-hint">photo arrives with the item</div>}
    </div>
  );
}

export function ItemShowcase({ item, prev, lotNo, offers, posts, isNew, done }: {
  item: Item; prev?: Item; lotNo: number; offers: LotOffer[]; posts: number; isNew: boolean; done: boolean;
}) {
  // price range marker: low .. avg .. high
  const span = Math.max(item.valueHigh - item.valueLow, 1e-9);
  const pos = Math.min(96, Math.max(4, ((item.estValueUsd - item.valueLow) / span) * 100));
  const lotOffers = offers.filter((o) => Date.parse(o.createdAt) >= Date.parse(item.acquiredAt)).reverse();
  const valued = lotOffers.filter((o) => o.evaluation);
  const best = valued.filter((o) => !["rejected", "expired"].includes(o.status)).sort((a, b) => b.evaluation!.estValueUsd - a.evaluation!.estValueUsd)[0];
  const declined = valued.filter((o) => o.status === "rejected").length;
  const notes = item.marketNotes || item.valuationNotes;

  // flash the price when it changes
  const last = useRef(item.estValueUsd);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (last.current !== item.estValueUsd) {
      last.current = item.estValueUsd;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
  }, [item.estValueUsd]);

  return (
    <section className="show" key={item.id}>
      <div className="show-l">
        <ItemVisual item={item} lotNo={lotNo} />
      </div>

      <div className="show-r">
        <div className="lot-meta">
          <span>Currently holding</span>
          <span>{item.acquiredFrom ? `from ${item.acquiredFrom}` : "the starting item"}</span>
          <span>held {held(item.acquiredAt)}</span>
          {isNew && <span className="new pulse-text">Just traded</span>}
          {done && <span className="new">Goal reached</span>}
        </div>
        <h1 className="show-name">{item.name}</h1>
        <p className="lot-desc">{item.description}</p>

        <div className="price">
          <div>
            <div className="price-k">Avg. selling price</div>
            <div className={`price-v ${flash ? "flash" : ""}`}><CountUp value={item.estValueUsd} duration={1400} /></div>
          </div>
          <div className="price-side">
            {prev ? (
              <span className={`chg ${item.estValueUsd < prev.estValueUsd ? "neg" : ""}`}>▲ {mult(item.estValueUsd / prev.estValueUsd)} on {prev.name}</span>
            ) : (
              <span className="muted">where it all starts</span>
            )}
          </div>
        </div>

        <div className="range2" role="img" aria-label={`Selling range ${money(item.valueLow)} to ${money(item.valueHigh)}`}>
          <div className="range2-track"><i /></div>
          <b style={{ left: `${pos}%` }}><em>avg</em></b>
          <div className="range2-l"><span>low {money(item.valueLow)}</span><span>high {money(item.valueHigh)}</span></div>
        </div>

        <div className="chips">
          <div className="chip2"><span>Offers on this lot</span><b><CountUp value={lotOffers.length} format={(n) => Math.round(n).toString()} duration={700} /></b></div>
          <div className="chip2"><span>Best offer</span><b>{best ? money(best.evaluation!.estValueUsd) : "—"}</b>{best && <em className="x">{mult(best.evaluation!.estValueUsd / item.estValueUsd)}</em>}</div>
          <div className="chip2"><span>Declined</span><b>{declined}</b></div>
          <div className="chip2"><span>Posts about it</span><b>{posts}</b></div>
        </div>

        <div className="offers">
          <div className="offers-h"><span>Offers on this lot</span><span className="muted">{lotOffers.length ? "newest first" : ""}</span></div>
          {lotOffers.length === 0 ? (
            <p className="empty" style={{ padding: "10px 0" }}>No offers yet. Clippy is asking around.</p>
          ) : (
            <ul>
              {lotOffers.slice(0, 6).map((o, i) => {
                const st = STATUS[o.status] ?? { label: o.status, cls: "st-dim" };
                const v = o.evaluation?.estValueUsd;
                return (
                  <li key={o.id} style={{ animationDelay: `${i * 60}ms` }}>
                    <span className="o-thumb">
                      {o.photos?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.photos[0]} alt="" />
                      ) : (
                        <span className="o-dot" />
                      )}
                    </span>
                    <span className="o-main">
                      <b title={o.itemName}>{o.itemName}</b>
                      <small>{o.from} · {o.channel}</small>
                    </span>
                    <span className={`o-st ${st.cls}`}>{st.label}</span>
                    <span className="o-v">{v != null ? money(v) : "…"}{v != null && <em className={v / item.estValueUsd >= 1.5 ? "x" : "x low"}>{mult(v / item.estValueUsd)}</em>}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {notes && (
          <details className="notes">
            <summary>How Clippy valued it</summary>
            <p>{notes}</p>
          </details>
        )}
      </div>
    </section>
  );
}
