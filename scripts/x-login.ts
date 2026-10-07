// One-time X login for the agent's account (OAuth 2.0 PKCE). Usage: npm run x:login
// Needs X_CLIENT_ID (and X_CLIENT_SECRET for "confidential" apps) in .env, and the callback URL
// http://localhost:3001/callback added in your X app's "User authentication settings".
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
if (fs.existsSync(".env")) process.loadEnvFile(".env");

const REDIRECT = "http://localhost:3001/callback";
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const state = crypto.randomBytes(8).toString("hex");

(async () => {
  const { tokenRequest, saveTok } = await import("../lib/agent/channels/xauth");
  if (!process.env.X_CLIENT_ID) throw new Error("Set X_CLIENT_ID in .env first");
  const url = "https://x.com/i/oauth2/authorize?" + new URLSearchParams({
    response_type: "code", client_id: process.env.X_CLIENT_ID, redirect_uri: REDIRECT,
    scope: process.env.X_DMS === "0" ? "tweet.read tweet.write users.read offline.access" : "tweet.read tweet.write users.read dm.read dm.write offline.access", state, code_challenge: challenge, code_challenge_method: "S256",
  });
  console.log(`\n1) Log into X as @${(process.env.X_HANDLE || "theagentclippy").replace(/^@/, "")} in your browser.`);
  console.log("\n2) Open this URL and click Authorize:\n\n" + url + "\n");
  console.log("3) After you click Authorize, X sends your browser to http://localhost:3001/callback?...");
  console.log("   • Running this on your own computer: that page finishes the login by itself.");
  console.log("   • Running it on the server (e.g. the DigitalOcean web console): the page will say it can't connect.");
  console.log("     That's expected – copy the WHOLE address from the browser's address bar, paste it here and press Enter.");
  console.log("     Do it within about 30 seconds; the code expires quickly. If it does, just run npm run x:login again.\n");

  let done = false;
  async function finish(u: URL): Promise<string> {
    if (done) return "already logged in";
    if (u.searchParams.get("error")) throw new Error(`X said: ${u.searchParams.get("error")}`);
    if (u.searchParams.get("state") !== state) throw new Error("this link is from a different login attempt – run npm run x:login again");
    const code = u.searchParams.get("code");
    if (!code) throw new Error("no code in that address – paste the full address bar URL");
    const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier });
    const me = await (await fetch("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    const want = (process.env.X_HANDLE || "theagentclippy").replace(/^@/, "").toLowerCase();
    if (me.data?.username?.toLowerCase() !== want) {
      console.error(`Wrong account: got @${me.data?.username}, expected @${want}. Nothing saved.`);
      throw new Error(`You authorised @${me.data?.username}, but the agent account is @${want}. Log into @${want} on x.com and run npm run x:login again.`);
    }
    saveTok({ ...tok, user_id: me.data?.id });
    done = true;
    console.log(`\n✓ Logged in as @${me.data?.username}. Saved data/x-token.json – tokens refresh automatically.`);
    console.log(`\nIf you ran this ON THE SERVER: you're done, nothing else to add.`);
    console.log(`If you ran it on your own computer, add these to the server's .env instead:\nX_USER_ID=${me.data?.id}\nX_REFRESH_TOKEN=${tok.refresh_token}\n(and don't run the agent on your computer – the refresh token rotates on first use)`);
    return `Logged in as @${me.data?.username}. You can close this tab.`;
  }
  const exit = () => setTimeout(() => process.exit(0), 300);

  // 1) local browser → callback server
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url!, REDIRECT);
    if (u.pathname !== "/callback") return res.end();
    try {
      res.end(await finish(u));
      exit();
    } catch (e: any) {
      res.end("Login failed: " + e.message);
      console.error("Login failed:", e.message);
    }
  }).listen(3001);
  srv.on("error", () => console.log("(port 3001 is busy – paste the address instead)"));

  // 2) pasted address (server / web console)
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk: string) => {
    const line = chunk.trim();
    if (!line) return;
    const m = line.match(/https?:\/\/\S+/) || (line.includes("code=") ? [`${REDIRECT}?${line.replace(/^.*?\?/, "")}`] : null);
    if (!m) return console.log("That doesn't look like the address – paste the whole URL starting with http://localhost:3001/callback");
    try {
      await finish(new URL(m[0]));
      srv.close();
      exit();
    } catch (e: any) {
      console.error("Login failed:", e.message);
    }
  });
})();
