// Worker: runs the agent loop every TICK_MINUTES. Usage:
//   npm run agent            -> run forever
//   npm run agent -- --once  -> single tick
//   npm run agent -- --ticks 30 --fast  -> 30 ticks back-to-back (demo fast-forward)
import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");

const args = process.argv.slice(2);
const once = args.includes("--once");
const ticksArg = args.indexOf("--ticks");
const maxTicks = once ? 1 : ticksArg >= 0 ? Number(args[ticksArg + 1]) : Infinity;
const fast = args.includes("--fast");

(async () => {
  const { tick } = await import("../lib/agent/loop");
  const { config } = await import("../lib/config");
  console.log(`Paperclip agent starting – mode=${config.mode}, llm=${config.anthropicKey ? config.model : "mock"}`);
  for (let i = 0; i < maxTicks; i++) {
    const db = await tick();
    const cur = db.items.find((x) => x.id === db.currentItemId)!;
    console.log(`── tick ${db.tickCount} done · holding ${cur.name} (~$${cur.estValueUsd}) · trades ${db.trades.length}\n`);
    if (cur.estValueUsd >= db.goalUsd) break;
    if (i < maxTicks - 1) await new Promise((r) => setTimeout(r, fast ? 50 : config.tickMinutes * 60_000));
  }
})();
