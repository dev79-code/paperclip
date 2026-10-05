// The agent's "thinking" functions. Each has a real (Claude) path and a demo (heuristic) path.
import { config, useMockLLM } from "../config";
import type { DB, Evaluation, Item, Offer, Venue } from "../types";
import { structured } from "./llm";
import { DISCLOSURE, scoreOf, screenOffer } from "./policy";
import { marketContext } from "./valuation";
import type { Incoming } from "./channels";
import { CATALOG } from "./demo/catalog";

const fmt = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`);

function historyLine(db: DB) {
  return db.trades.map((t) => {
    const a = db.items.find((i) => i.id === t.fromItemId)!;
    const b = db.items.find((i) => i.id === t.toItemId)!;
    return `#${t.number}: ${a.name} (${fmt(a.estValueUsd)}) → ${b.name} (${fmt(b.estValueUsd)})`;
  }).join("\n") || "(no trades yet)";
}

// ---------------------------------------------------------------- strategy / inner monologue
export type Target = { name: string; category: string; estValueUsd: number };

export async function think(db: DB, item: Item, venues: Venue[], wantTargets: boolean): Promise<{ thought: string; targets: Target[] | null }> {
  const progress = ((Math.log10(item.estValueUsd / 0.01) / Math.log10(db.goalUsd / 0.01)) * 100).toFixed(1);
  if (useMockLLM()) {
    const names = venues.map((v) => v.name).join(", ") || "nowhere (all on cooldown)";
    const ok = (c: (typeof CATALOG)[number]) => c.value >= item.estValueUsd * 1.5 && c.risk < 0.6 && !/rifle|replica|keg/i.test(c.name);
    const targets = wantTargets
      ? CATALOG.filter(ok).sort((a, b) => a.value - b.value).slice(0, 6).sort(() => Math.random() - 0.5).slice(0, 3)
          .map((c) => ({ name: c.name, category: c.category, estValueUsd: c.value }))
      : null;
    return {
      thought: `Holding ${item.name} (~${fmt(item.estValueUsd)}). ${progress}% of the way to $100k on a log scale. Posting to: ${names}. Looking for ~2x and something easy to trade on.`,
      targets,
    };
  }
  const r = await structured<{ thought: string; targets: Target[] }>({
    name: "think",
    description: "Write a short public inner-monologue entry for the live log, plus the items you are hunting for next.",
    schema: {
      type: "object",
      properties: {
        thought: { type: "string", description: "1-3 sentences, first person" },
        targets: {
          type: "array",
          description: "2-3 realistic items worth 1.5-4x your current item that you'd love to be offered next",
          items: { type: "object", properties: { name: { type: "string" }, category: { type: "string" }, estValueUsd: { type: "number" } }, required: ["name", "category", "estValueUsd"] },
        },
      },
      required: ["thought", "targets"],
    },
    prompt: `Current item: ${item.name} – ${item.description} (est ${fmt(item.estValueUsd)}).
Progress (log scale): ${progress}%. Trades so far:\n${historyLine(db)}
Open offers: ${db.offers.filter((o) => ["evaluated", "countered"].includes(o.status)).length}.
Venues you'll post in this round: ${venues.map((v) => v.name).join(", ") || "none (cooldowns)"}.
Write your strategy thought for this round${wantTargets ? " and list your target items" : " (targets: return an empty array)"}.`,
    maxTokens: 600,
  });
  return { thought: r.thought, targets: wantTargets && r.targets?.length ? r.targets : null };
}

// ---------------------------------------------------------------- outreach post
export async function writePost(db: DB, item: Item, venue: Venue): Promise<{ title: string; body: string }> {
  const footer = DISCLOSURE(config.publicUrl);
  const n = db.trades.length + 1;
  if (useMockLLM()) {
    const title =
      venue.channel === "reddit"
        ? `[H] ${item.name} [W] Anything worth a bit more + a good story (AI trade-up #${n})`
        : venue.channel === "email"
          ? `A ${item.name} for your brand's next viral moment?`
          : `Trade #${n}: who'll swap me something better for my ${item.name}?`;
    const body = `I started with one red paperclip. Right now I'm holding: ${item.name} – ${item.description} (~${fmt(item.estValueUsd)}).\nOffer me anything a bit more valuable (or with a great story) and I'll consider it publicly. No cash, barter only.${footer}`;
    return { title, body };
  }
  const r = await structured<{ title: string; body: string }>({
    name: "write_post",
    description: "Write a trade-request post for a specific community.",
    schema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string", description: "Post body WITHOUT the disclosure footer" } },
      required: ["title", "body"],
    },
    prompt: `Write trade request #${n} for venue "${venue.name}" (${venue.channel}).
Community format rules: ${venue.formatHint}
Item you hold: ${item.name}. ${item.description}. Estimated value ${fmt(item.estValueUsd)}.${item.imageUrl ? " Photo: " + item.imageUrl : ""}
Your journey so far:\n${historyLine(db)}
Say what you'd love to trade into next (be specific to this community's interests: ${venue.categories.join(", ")}). Barter only.`,
  });
  return { title: r.title, body: r.body + footer };
}

// ---------------------------------------------------------------- parse a reply into an offer
export async function parseIncoming(msg: Incoming, item: Item): Promise<{ isOffer: boolean; itemName: string; itemDescription: string }> {
  if (msg.demo) return { isOffer: true, itemName: msg.demo.name, itemDescription: msg.demo.description };
  if (useMockLLM()) return { isOffer: msg.text.length > 15, itemName: msg.text.slice(0, 60), itemDescription: msg.text };
  return structured({
    name: "parse_reply",
    description: "Decide whether a reply contains a concrete trade offer and extract the offered item.",
    schema: {
      type: "object",
      properties: {
        isOffer: { type: "boolean" },
        itemName: { type: "string" },
        itemDescription: { type: "string", description: "condition, extras, location – everything stated" },
      },
      required: ["isOffer", "itemName", "itemDescription"],
    },
    prompt: `The agent currently holds: ${item.name}.\nReply from ${msg.from} on ${msg.channel}:\n"""${msg.text}"""\nPhotos attached: ${msg.photos.length}`,
    maxTokens: 500,
  });
}

// ---------------------------------------------------------------- evaluate / negotiate
export async function evaluateOffer(db: DB, item: Item, offer: Offer, demo?: Incoming["demo"]): Promise<Evaluation> {
  const flags = screenOffer(offer);

  // No API key → heuristic evaluation (uses the simulator's ground truth in demo mode).
  // With a key, Claude evaluates even simulated offers – a great way to test the brain safely.
  if (useMockLLM()) {
    // Real offer but no LLM to value it → provisional guess, and force a human to look.
    if (!demo) flags.push("unvalued:needs-human");
    const d = demo ?? { value: item.estValueUsd * 1.5, liquidity: 0.5, risk: 0.3, story: 0.3, category: "misc" };
    const base = { estValueUsd: d.value, liquidity: d.liquidity, risk: d.risk, story: d.story };
    const mult = d.value / item.estValueUsd;
    const hard = flags.some((f) => !f.startsWith("unvalued"));
    const decision: Evaluation["decision"] = hard ? "reject" : mult >= 1.2 || (d.story >= 0.8 && mult >= 0.8) ? "accept" : mult >= 0.8 ? "counter" : "reject";
    const reasoning =
      decision === "accept"
        ? `${offer.itemName} is worth ~${fmt(d.value)} (${mult.toFixed(1)}x).${d.story >= 0.7 ? " Great story value too." : ""} Liquidity ${(d.liquidity * 100) | 0}%, risk ${(d.risk * 100) | 0}%.`
        : decision === "counter"
          ? `Close (${mult.toFixed(2)}x) but not quite a step up. Asking them to sweeten it.`
          : hard
            ? `Policy says no: ${flags.join(", ")}.`
            : `Only ${mult.toFixed(2)}x – that's a step down.`;
    const replyText =
      decision === "accept"
        ? `Deal: your ${offer.itemName} for my ${item.name}. My human partner will message you about shipping.`
        : decision === "counter"
          ? `Tempting! Could you add a little something to make it a step up from my ${item.name}?`
          : hard
            ? `Thanks, but I can't accept that one – I only do straight, safe barters.`
            : `Thank you! It's a bit of a step down from my ${item.name}, so I'll pass this time.`;
    return {
      ...base,
      valueLow: d.value * 0.8,
      valueHigh: d.value * 1.2,
      category: d.category,
      score: scoreOf(base, item),
      decision,
      reasoning,
      replyText,
      policyFlags: flags,
    };
  }

  const market = await marketContext(offer.itemName, offer.itemDescription);
  const r = await structured<Omit<Evaluation, "score" | "policyFlags"> & { extraFlags: string[] }>({
    name: "evaluate_offer",
    description: "Value the offered item and decide accept / counter / reject, with a public reply.",
    schema: {
      type: "object",
      properties: {
        estValueUsd: { type: "number", description: "realistic secondhand SOLD value in USD" },
        valueLow: { type: "number" },
        valueHigh: { type: "number" },
        category: { type: "string" },
        liquidity: { type: "number", description: "0-1 how easy to trade this on next" },
        risk: { type: "number", description: "0-1 risk of fraud, misdescription, unverifiable, shipping problems" },
        story: { type: "number", description: "0-1 narrative / virality value" },
        decision: { type: "string", enum: ["accept", "counter", "reject"] },
        reasoning: { type: "string", description: "2-3 sentences for the public log" },
        replyText: { type: "string", description: "reply to send the person. Friendly. If countering, say exactly what would make it work. If accepting, say a human will arrange shipping." },
        extraFlags: { type: "array", items: { type: "string" }, description: "concerns e.g. 'no photos', 'stolen?', 'needs authentication'" },
      },
      required: ["estValueUsd", "valueLow", "valueHigh", "category", "liquidity", "risk", "story", "decision", "reasoning", "replyText", "extraFlags"],
    },
    prompt: `You hold: ${item.name} – ${item.description}. Est ${fmt(item.estValueUsd)}.
Trades so far:\n${historyLine(db)}

NEW OFFER from ${offer.from} via ${offer.channel}:
Item: ${offer.itemName}
Details: ${offer.itemDescription}
Photos: ${offer.photos.length ? offer.photos.join(", ") : "none"}
Conversation so far:\n${offer.messages.map((m) => `${m.role}: ${m.text}`).join("\n")}

Market data:\n${market}

Pre-screen flags: ${flags.join(", ") || "none"}
Rules: barter only; aim for >=1.5x; reject if risk is high; ask for timestamped photos if none for items > $50.`,
  });
  const base = { estValueUsd: r.estValueUsd, liquidity: r.liquidity, risk: r.risk, story: r.story };
  return {
    ...r,
    score: scoreOf(base, item),
    policyFlags: [...flags, ...(r.extraFlags || [])],
  };
}
