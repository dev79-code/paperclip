// Preflight: run on the server before switching to AGENT_MODE=live.
//   npm run preflight
// Read-only checks plus ONE tiny AI call (a fraction of a cent). Never posts, never sends DMs, never moves money.
// Prints no secrets. Exit code 1 if anything blocking is wrong.
import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");

type Level = "ok" | "warn" | "fail";
const results: { level: Level; area: string; msg: string }[] = [];
const ok = (area: string, msg: string) => results.push({ level: "ok", area, msg });
const warn = (area: string, msg: string) => results.push({ level: "warn", area, msg });
const fail = (area: string, msg: string) => results.push({ level: "fail", area, msg });
const env = (k: string) => (process.env[k] || "").trim();
const timeout = (ms: number) => AbortSignal.timeout(ms);

async function main() {
  const { config } = await import("../lib/config");

  // ------------------------------------------------------------ basics
  if (!fs.existsSync(".env")) fail("config", "no .env file in this folder");
  const pw = env("ADMIN_PASSWORD");
  if (!pw || pw === "change-me") fail("config", "ADMIN_PASSWORD is not set");
  else if (pw.length < 14) warn("config", "ADMIN_PASSWORD is short – use 14+ random characters");
  else ok("config", "admin password set");

  const pub = config.publicUrl;
  if (!/^https:\/\//.test(pub) || /localhost/.test(pub)) fail("config", `PUBLIC_URL should be your https site (now: ${pub})`);
  else ok("config", `public URL ${pub}`);
  ok("config", `mode: ${config.mode}${config.mode === "demo" ? " (set AGENT_MODE=live to go live)" : ""} · a round every ${config.tickMinMinutes}–${config.tickMaxMinutes} min`);

  try {
    fs.mkdirSync("data", { recursive: true });
    fs.accessSync("data", fs.constants.W_OK);
    ok("storage", "data/ is writable");
  } catch {
    fail("storage", "data/ is not writable by this user");
  }
  if (fs.existsSync("data/db.json.lock")) {
    const age = (Date.now() - fs.statSync("data/db.json.lock").mtimeMs) / 60000;
    if (age > 30) warn("storage", `stale lock file (${age.toFixed(0)} min old) – it will be cleared automatically`);
  }

  // ------------------------------------------------------------ AI
  if (config.provider === "none") fail("ai", "no OPENROUTER_API_KEY / ANTHROPIC_API_KEY – the agent would run on dumb heuristics");
  else if (config.provider === "openrouter") {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${config.openrouterKey}` }, signal: timeout(10000) });
      if (!r.ok) fail("ai", `OpenRouter key rejected (${r.status})`);
      else {
        const d = (await r.json()).data || {};
        const left = d.limit_remaining ?? (d.limit != null ? d.limit - d.usage : null);
        if (left != null && left < 5) fail("ai", `OpenRouter key has only $${Number(left).toFixed(2)} left – raise its limit`);
        else if (left != null && left < 20) warn("ai", `OpenRouter key has $${Number(left).toFixed(2)} left`);
        else ok("ai", `OpenRouter key ok${left != null ? ` ($${Number(left).toFixed(2)} left)` : " (no limit)"}`);
        if (d.expires_at && Date.parse(d.expires_at) - Date.now() < 30 * 86400000) warn("ai", `OpenRouter key expires ${String(d.expires_at).slice(0, 10)}`);
      }
    } catch (e: any) {
      fail("ai", `can't reach OpenRouter: ${e.message}`);
    }
  }
  if (config.provider !== "none") {
    try {
      const { structured } = await import("../lib/agent/llm");
      const r = await structured<{ ok: boolean }>({
        name: "ping",
        description: "Health check",
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        prompt: "Health check: return ok=true.",
        maxTokens: 50,
      });
      r?.ok ? ok("ai", `model ${config.model} answered`) : fail("ai", `model ${config.model} gave an odd answer`);
    } catch (e: any) {
      fail("ai", `model ${config.model} failed: ${String(e.message || e).slice(0, 160)}`);
    }
  }

  // ------------------------------------------------------------ X
  const { loadTok, xAccessToken } = await import("../lib/agent/channels/xauth");
  if (!env("X_CLIENT_ID")) fail("x", "X_CLIENT_ID missing");
  if (!env("X_USER_TOKEN") && !loadTok()) fail("x", "not logged in – run `npm run x:login` and put X_REFRESH_TOKEN + X_USER_ID in .env");
  else {
    try {
      const tok = await xAccessToken(); // refreshes (and saves the rotated token) if needed
      const me = await fetch("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${tok}` }, signal: timeout(10000) });
      if (!me.ok) fail("x", `X login rejected (${me.status}) – run \`npm run x:login\` again`);
      else {
        const u = (await me.json()).data;
        if (u.username.toLowerCase() !== config.xHandle.toLowerCase()) fail("x", `logged in as @${u.username}, but X_HANDLE is @${config.xHandle}`);
        else ok("x", `logged in as @${u.username}`);
        if (env("X_USER_ID") && env("X_USER_ID") !== u.id) warn("x", "X_USER_ID in .env doesn't match the logged-in account");
      }
      if (process.env.X_DMS !== "0") {
        const dm = await fetch("https://api.x.com/2/dm_events?max_results=1", { headers: { Authorization: `Bearer ${tok}` }, signal: timeout(10000) });
        if (dm.status === 403) fail("x", "no DM access – set the app to \"Read and write and Direct message\", then run x:login again");
        else if (dm.status === 402) fail("x", "X API credits/plan don't cover DMs – top up in the developer console");
        else if (!dm.ok) warn("x", `DM check returned ${dm.status}`);
        else ok("x", "can read DMs");
      }
    } catch (e: any) {
      fail("x", String(e.message || e).slice(0, 200));
    }
  }

  // ------------------------------------------------------------ venues
  const { load } = await import("../lib/db");
  const db = load();
  const live = db.venues.filter((v) => ["granted", "not_required"].includes(v.permission));
  const { xChannel } = await import("../lib/agent/channels/x");
  const { emailChannel } = await import("../lib/agent/channels/email");
  const { discourseChannel } = await import("../lib/agent/channels/discourse");
  const real: Record<string, { configured(): boolean }> = { x: xChannel, email: emailChannel, discourse: discourseChannel }; // reddit is on hold
  const usable = live.filter((v) => real[v.channel]?.configured());
  if (!usable.length) fail("venues", "no venue the agent can actually post to");
  else ok("venues", `will post to: ${usable.map((v) => v.name).join(", ")}`);
  const skipped = db.venues.filter((v) => !usable.includes(v));
  if (skipped.length) ok("venues", `skipped (not set up / no permission): ${skipped.map((v) => v.name).join(", ")}`);
  if (db.offers.some((o) => o.sim) || db.trades.length) warn("data", `the database still has demo data (${db.trades.length} trades) – run \`npm run reset\` before going live`);
  else ok("data", "clean start: holding " + (db.items.find((i) => i.id === db.currentItemId)?.name || "?"));

  // ------------------------------------------------------------ wallet
  const { limits } = await import("../lib/wallet/payouts");
  const L = limits();
  if (!L.enabled) ok("wallet", "switched off (WALLET_ENABLED=0) – no payments will be made");
  else {
    const sol = await import("../lib/wallet/solana");
    if (!sol.hasWallet()) fail("wallet", "WALLET_ENABLED=1 but no wallet – run `npm run wallet -- create`");
    else {
      const mode = fs.statSync(sol.KEY_FILE).mode & 0o777;
      if (mode & 0o077) fail("wallet", `data/wallet.json is readable by others (chmod 600 data/wallet.json)`);
      ok("wallet", `${sol.NETWORK} · ${sol.walletAddress()}`);
      if (sol.NETWORK === "mainnet") warn("wallet", "MAINNET – real money. Keep only a small float in it.");
      try {
        const b = await sol.balances();
        if (b.sol < L.solReserve) fail("wallet", `only ${b.sol} SOL – needs at least ${L.solReserve} for fees`);
        else ok("wallet", `balance ${b.usdc.toFixed(2)} USDC · ${b.sol.toFixed(4)} SOL`);
        if (b.usdc < L.shipping) warn("wallet", `USDC balance is below one shipping refund ($${L.shipping})`);
      } catch (e: any) {
        fail("wallet", `can't read balance from Solana RPC: ${e.message}`);
      }
      if (!(await sol.solUsd())) warn("wallet", "no SOL price (set SOL_USD_FALLBACK) – SOL tips will wait for approval");
      ok("wallet", `auto-pay limits: $${L.perPayment}/payment · $${L.perDay}/day · $${L.perRecipientDay}/person/day`);
    }
  }

  // ------------------------------------------------------------ email (optional)
  if (env("RESEND_API_KEY") && !env("EMAIL_WEBHOOK_SECRET") && !env("RESEND_WEBHOOK_SECRET"))
    warn("email", "no webhook secret – inbound email replies won't be accepted");

  // ------------------------------------------------------------ public site
  try {
    const r = await fetch(`${pub.replace(/\/$/, "")}/api/state`, { signal: timeout(10000) });
    const j = r.ok ? await r.json() : null;
    if (!j) fail("site", `${pub}/api/state returned ${r.status}`);
    else ok("site", `site reaches the backend (mode ${j.mode}, round ${j.tickCount})`);
  } catch (e: any) {
    fail("site", `can't load ${pub}/api/state: ${e.message}`);
  }

  // ------------------------------------------------------------ report
  const icon = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };
  console.log("\nClippy.fun preflight\n");
  for (const r of results) console.log(` ${icon[r.level]} ${r.area.padEnd(8)} ${r.msg}`);
  const f = results.filter((r) => r.level === "fail").length, w = results.filter((r) => r.level === "warn").length;
  console.log(`\n${f ? `\x1b[31m${f} blocking problem(s)\x1b[0m – fix these before going live.` : "\x1b[32mReady for live.\x1b[0m"}${w ? ` ${w} warning(s).` : ""}\n`);
  process.exit(f ? 1 : 0);
}

main().catch((e) => {
  console.error("preflight crashed:", e);
  process.exit(1);
});
