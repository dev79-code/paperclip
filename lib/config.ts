// LLM provider: "openrouter" if OPENROUTER_API_KEY is set (or LLM_PROVIDER=openrouter),
// otherwise "anthropic" if ANTHROPIC_API_KEY is set. No key at all → demo heuristics.
const provider = (process.env.LLM_PROVIDER ||
  (process.env.OPENROUTER_API_KEY ? "openrouter" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "none")) as "openrouter" | "anthropic" | "none";

export const config = {
  provider,
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  model:
    provider === "openrouter"
      ? process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5"
      : process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
  webSearch: process.env.WEB_SEARCH !== "0",
  /** demo = simulated venues & counterparties. live = real channels (only configured + permitted venues). */
  mode: (process.env.AGENT_MODE === "live" ? "live" : "demo") as "live" | "demo",
  adminPassword: process.env.ADMIN_PASSWORD || "change-me",
  approvalThresholdUsd: Number(process.env.APPROVAL_THRESHOLD_USD || 250),
  tickMinutes: Number(process.env.TICK_MINUTES || 15),
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",
  /** the agent's own X account (without @) */
  xHandle: (process.env.X_HANDLE || "theagentclippy").replace(/^@/, ""),
  maxPostsPerTick: Number(process.env.MAX_POSTS_PER_TICK || 2),
};

export const useMockLLM = () =>
  config.provider === "none" || (config.provider === "openrouter" ? !config.openrouterKey : !config.anthropicKey);
