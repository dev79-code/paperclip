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

/** Apply hard rules on top of the model's opinion. Returns the final evaluation. */
export function enforce(ev: Evaluation, current: Item): Evaluation {
  const out = { ...ev, policyFlags: [...ev.policyFlags] };
  const mult = ev.estValueUsd / Math.max(current.estValueUsd, 0.0001);

  if (out.policyFlags.some((f) => f.startsWith("banned") || f.startsWith("cash"))) {
    out.decision = "reject";
  }
  if (out.policyFlags.includes("scam-pattern") || ev.risk > 0.6) {
    if (out.decision === "accept") out.decision = "reject";
    out.policyFlags.push("risk-too-high");
  }
  // Never trade down unless it's a great story and only a small step down.
  if (out.decision === "accept" && mult < 1) {
    if (!(ev.story >= 0.8 && mult >= 0.7)) {
      out.decision = "counter";
      out.policyFlags.push("downtrade-blocked");
    }
  }
  // Sanity: absurd jumps are almost always fraud or mis-valuation.
  if (out.decision === "accept" && mult > 50 && current.estValueUsd > 5) {
    out.policyFlags.push("implausible-jump:needs-human");
  }
  return out;
}

export function needsApproval(ev: Evaluation) {
  return ev.estValueUsd >= config.approvalThresholdUsd || ev.policyFlags.some((f) => f.includes("needs-human"));
}

export function scoreOf(ev: Pick<Evaluation, "estValueUsd" | "liquidity" | "risk" | "story">, current: Item) {
  const mult = ev.estValueUsd / Math.max(current.estValueUsd, 0.0001);
  return +(Math.log2(Math.max(mult, 0.01)) + ev.story * 0.8 + ev.liquidity * 0.5 - ev.risk * 2).toFixed(3);
}
