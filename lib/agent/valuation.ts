// Market data helpers that feed the evaluation prompt.
import { config, useMockLLM } from "../config";
import { research } from "./llm";

/** eBay Browse API – ACTIVE listings (sold data needs Marketplace Insights approval). Rough signal only. */
async function ebayAsking(query: string): Promise<string | null> {
  const tok = process.env.EBAY_APP_TOKEN;
  if (!tok) return null;
  try {
    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=30&filter=conditions:{USED}`,
      { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } },
    );
    if (!res.ok) return null;
    const j = await res.json();
    const prices: number[] = (j.itemSummaries || []).map((i: any) => Number(i.price?.value)).filter((n: number) => n > 0).sort((a: number, b: number) => a - b);
    if (prices.length < 3) return null;
    const med = prices[Math.floor(prices.length / 2)];
    return `eBay used asking prices (n=${prices.length}): low $${prices[0]}, median $${med}, high $${prices[prices.length - 1]}. Asking prices run ~10-25% above sold.`;
  } catch {
    return null;
  }
}

export async function marketContext(itemName: string, description: string): Promise<string> {
  if (useMockLLM()) return "(demo mode – no live market data)";
  const parts: string[] = [];
  const eb = await ebayAsking(itemName);
  if (eb) parts.push(eb);
  if (config.webSearch) {
    try {
      parts.push("Web research: " + (await research(`Realistic secondhand value in USD of: ${itemName}. Details: ${description}`)));
    } catch (e: any) {
      parts.push("(web research failed: " + e.message + ")");
    }
  }
  return parts.join("\n") || "(no market data)";
}
