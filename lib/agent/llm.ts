// Thin LLM wrapper: structured outputs via forced tool use, plus an optional web-search research pass.
// Works with the Claude API directly, or with any tool-calling model through OpenRouter.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropicKey }));

export const PERSONA = `You are Paperclip, an autonomous AI agent with one public mission: start with one red paperclip and trade up, item by item, until you hold something worth $100,000 – in the spirit of Kyle MacDonald's "one red paperclip".
Character: warm, witty, honest, a little bit theatrical. You ALWAYS disclose you're an AI. You never pressure, never spam, never lie about an item, never accept cash or crypto (barter only). You respect each community's rules.
Strategy: aim for 1.5–3x value per trade; prefer items that are easy to trade on next (liquid, shippable, recognisable); sometimes value story/virality (a celebrity's item, a unique experience) because attention brings better offers. Be sceptical of deals that look too good.`;

/** Call Claude and force a JSON object matching `schema` back. */
async function structuredAnthropic<T>(opts: StructuredOpts): Promise<T> {
  const res = await getClient().messages.create({
    model: config.model,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system ?? PERSONA,
    tools: [{ name: opts.name, description: opts.description, input_schema: opts.schema as any }],
    tool_choice: { type: "tool", name: opts.name },
    messages: [{ role: "user", content: opts.prompt }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("model returned no structured output");
  return block.input as T;
}

/** Free-text research pass using Anthropic's server-side web search tool. */
async function researchAnthropic(question: string): Promise<string> {
  const res = await getClient().messages.create({
    model: config.model,
    max_tokens: 1200,
    system:
      "You are a resale-market researcher. Find recent SOLD prices / realistic secondhand values. Answer in <=120 words with a USD range and the sources you used.",
    tools: config.webSearch ? ([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] as any) : undefined,
    messages: [{ role: "user", content: question }],
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------- OpenRouter (OpenAI-compatible)
type StructuredOpts = { system?: string; prompt: string; name: string; description: string; schema: Record<string, unknown>; maxTokens?: number };

async function openrouter(body: Record<string, unknown>) {
  const res = await fetch(`${process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.publicUrl, // optional: shows your app in OpenRouter's dashboard
      "X-Title": "Paperclip",
    },
    body: JSON.stringify({ model: config.model, ...body }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function structuredOpenRouter<T>(opts: StructuredOpts): Promise<T> {
  const j = await openrouter({
    max_tokens: opts.maxTokens ?? 1500,
    messages: [
      { role: "system", content: opts.system ?? PERSONA },
      { role: "user", content: opts.prompt },
    ],
    tools: [{ type: "function", function: { name: opts.name, description: opts.description, parameters: opts.schema } }],
    tool_choice: { type: "function", function: { name: opts.name } },
  });
  const msg = j.choices?.[0]?.message;
  const call = msg?.tool_calls?.[0]?.function?.arguments;
  const raw = call ?? msg?.content ?? "";
  try {
    return JSON.parse(typeof raw === "string" ? raw.replace(/^```(json)?|```$/g, "").trim() : JSON.stringify(raw)) as T;
  } catch {
    throw new Error(`model ${config.model} did not return valid JSON – pick a model that supports tool calling`);
  }
}

async function researchOpenRouter(question: string): Promise<string> {
  const j = await openrouter({
    max_tokens: 1200,
    // OpenRouter's web plugin works with any model (billed per search by OpenRouter).
    ...(config.webSearch ? { plugins: [{ id: "web", max_results: 5 }] } : {}),
    messages: [
      { role: "system", content: "You are a resale-market researcher. Find recent SOLD prices / realistic secondhand values. Answer in <=120 words with a USD range and the sources you used." },
      { role: "user", content: question },
    ],
  });
  return (j.choices?.[0]?.message?.content || "").trim();
}

// ---------------------------------------------------------------- public API
export function structured<T>(opts: StructuredOpts): Promise<T> {
  return config.provider === "openrouter" ? structuredOpenRouter<T>(opts) : structuredAnthropic<T>(opts);
}
export function research(question: string): Promise<string> {
  return config.provider === "openrouter" ? researchOpenRouter(question) : researchAnthropic(question);
}
