// DEMO channel: simulates a community replying to the agent's trade requests so the whole loop can
// be watched end-to-end with no accounts or API keys. Nothing leaves the machine.
import { CATALOG, HANDLES, type CatalogItem } from "../demo/catalog";
import type { Channel, Incoming } from "./types";
import type { DB, Venue } from "../../types";

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function candidates(db: DB, venue: Venue, justOffered: Set<string>): CatalogItem[] {
  const cur = db.items.find((i) => i.id === db.currentItemId)!.estValueUsd;
  const used = new Set(db.items.map((i) => i.name));
  const offered = new Set(db.offers.filter((o) => o.status !== "expired").map((o) => o.sim?.name ?? o.itemName));
  const fits = (c: CatalogItem) =>
    !used.has(c.name) && !offered.has(c.name) && !justOffered.has(c.name) && (venue.categories.includes("*") || venue.categories.includes(c.category));
  // Most people offer something in the 0.6x–5x range of what you hold…
  let pool = CATALOG.filter((c) => fits(c) && c.value >= cur * 0.6 && c.value <= cur * 5);
  // …plus the occasional bad actor (scam / banned item) to exercise the guardrails.
  if (Math.random() < 0.18) pool = pool.concat(CATALOG.filter((c) => fits(c) && (c.risk >= 0.6 || /rifle|replica/i.test(c.name))));
  if (!pool.length) pool = CATALOG.filter((c) => fits(c) && c.value > cur).sort((a, b) => a.value - b.value).slice(0, 2);
  return pool;
}

const PHRASES = [
  (c: CatalogItem) => `I'll trade you my ${c.name} for it! ${c.description}`,
  (c: CatalogItem) => `Love this project. Got a ${c.name} gathering dust – ${c.description} Want it?`,
  (c: CatalogItem) => `Offer: ${c.name}. ${c.description} Photos on request.`,
  (c: CatalogItem) => `Haha ok I'm in. ${c.name} for your current item? ${c.description}`,
];

export const demoChannel: Channel = {
  id: "demo",
  configured: () => true,

  async publish(venue) {
    const id = "demo_" + Math.random().toString(36).slice(2, 9);
    return { externalId: id, url: undefined };
  },

  async fetchReplies(db, venue, posts) {
    const out: Incoming[] = [];
    const justOffered = new Set<string>();
    const recent = posts.filter((p) => p.venueId === venue.id && p.itemId === db.currentItemId).slice(-2);
    for (const p of recent) {
      const n = Math.random() < 0.55 ? 1 : Math.random() < 0.4 ? 2 : 0;
      for (let i = 0; i < n; i++) {
        const pool = candidates(db, venue, justOffered);
        if (!pool.length) break;
        const c = pick(pool);
        justOffered.add(c.name);
        const noise = 0.85 + Math.random() * 0.3;
        out.push({
          channel: venue.channel,
          venueId: venue.id,
          postId: p.id,
          from: pick(HANDLES),
          text: pick(PHRASES)(c),
          threadRef: "demo_thread_" + Math.random().toString(36).slice(2, 9),
          photos: [],
          demo: { ...c, value: +(c.value * noise).toFixed(2) },
        });
      }
    }
    return out;
  },

  async reply() {
    /* simulated – logged by the loop */
  },
};
