import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
(async () => {
  const { submit } = await import("../lib/store");
  const r = await submit({ type: "reset" });
  console.log(r.applied ? "Reset: back to one red paperclip." : "Reset queued – it will apply when the current agent round finishes.");
})();
