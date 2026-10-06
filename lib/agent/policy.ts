// Hard guardrails. The LLM proposes, policy disposes – nothing here is overridable by the model.
import { config } from "../config";
import type { Evaluation, Item, Offer } from "../types";

const BANNED: [RegExp, string][] = [
  [/\b(gun|firearm|rifle|pistol|shotgun|ammo|ammunition|silencer|suppressor)\b/i, "weapons"],
  [/\b(alcohol|whisk(e)?y|vodka|wine(?! red)|beer|tobacco|cigar|vape|nicotine)\b/i, "age-restricted goods"],
  [/\b(cannabis|weed|thc|cbd|prescription|pills|steroid)\b/i, "drugs / medication"],
  [/\b(puppy|kitten|live animal|pet|reptile|parrot)\b/i, "live animals"],
  [/\b(replica|counterfeit|fake|rep|super ?clone|1:1)\b/i, "counterfeit"],
];

const CASH = /\b(cash|paypal|venmo|zelle|wire|bank transfer|usdt|usdc|bitcoin|btc|eth|crypto)\b/i;
const SCAM = /\b(ship (yours|it) first|no photos|friends and family|f&f only|gift ?card only|western union)\b/i;

export const DISCLOSURE = (url: string) =>
  `\n\n— I'm Paperclip, an AI agent trading one red paperclip up to $100k. A human checks every shipment. Live log: ${url}`;

export function screenOffer(offer: Pick<Offer, "rawText" | "itemName" | "itemDescription">): string[] {
  const text = `${offer.itemName} ${offer.itemDescription} ${offer.rawText}`;
  const flags: string[] = [];
  for (const [re, label] of BANNED) if (re.test(text)) flags.push(`banned:${label}`);
  if (CASH.test(`${offer.itemName} ${offer.itemDescription}`)) flags.push("cash-or-crypto (barter only)");
  if (SCAM.test(text)) flags.push("scam-pattern");
  return flags;
}

/** Apply hard rules on top of the model's opinion. Returns the final evaluation.
 *  If the rules change the decision, the model's drafted reply is replaced too – otherwise someone
 *  could be told "Deal!" while the agent actually rejects them. */
export function enforce(ev: Evaluation, current: Item): Evaluation {
  const out = { ...ev, policyFlags: [...ev.policyFlags] };
  const mult = ev.estValueUsd / Math.max(current.estValueUsd, 0.0001);
  let why: "banned" | "risk" | "downtrade" | null = null;

  if (out.policyFlags.some((f) => f.startsWith("banned") || f.startsWith("cash"))) {
    out.decision = "reject";
    why = "banned";
  }
  if (out.policyFlags.includes("scam-pattern") || ev.risk > 0.6) {
    if (out.decision !== "reject") {
      out.decision = "reject";
      why = "risk";
    }
    out.policyFlags.push("risk-too-high");
  }
  // Never trade down unless it's a great story and only a small step down.
  if (out.decision === "accept" && mult < 1) {
    if (!(ev.story >= 0.8 && mult >= 0.7)) {
      out.decision = "counter";
      out.policyFlags.push("downtrade-blocked");
      why = "downtrade";
    }
  }
  // Sanity: absurd jumps are almost always fraud or mis-valuation.
  if (out.decision === "accept" && mult > 50 && current.estValueUsd > 5) {
    out.policyFlags.push("implausible-jump:needs-human");
  }

  if (out.decision !== ev.decision) {
    out.replyText = policyReply(out.decision, why, current);
    out.reasoning = `${ev.reasoning} Overruled by the rules (${why}): ${ev.decision} → ${out.decision}.`;
  }
  return out;
}

/** Fixed replies used whenever the rules overrule the model. */
export function policyReply(decision: Evaluation["decision"], why: "banned" | "risk" | "downtrade" | null, current: Item) {
  if (decision === "counter") return `Tempting, but that would be a step down from my ${current.name}. Could you add something to make it a step up?`;
  if (decision === "reject" && why === "banned") return `Thanks for the offer, but I can't accept that one. I only do straight barters, with no cash, crypto or restricted items.`;
  if (decision === "reject") return `Thanks for the offer! I can't go ahead with this one as it stands. I need clear, recent photos and normal shipping terms for every trade.`;
  return `Thanks! Let me think about this one.`;
}

export function needsApproval(ev: Evaluation) {
  return ev.estValueUsd >= config.approvalThresholdUsd || ev.policyFlags.some((f) => f.includes("needs-human"));
}

export function scoreOf(ev: Pick<Evaluation, "estValueUsd" | "liquidity" | "risk" | "story">, current: Item) {
  const mult = ev.estValueUsd / Math.max(current.estValueUsd, 0.0001);
  return +(Math.log2(Math.max(mult, 0.01)) + ev.story * 0.8 + ev.liquidity * 0.5 - ev.risk * 2).toFixed(3);
}
