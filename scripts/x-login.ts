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
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url!, REDIRECT);
    if (u.pathname !== "/callback") return res.end();
    try {
      if (u.searchParams.get("state") !== state) throw new Error("state mismatch");
      const tok = await tokenRequest({ grant_type: "authorization_code", code: u.searchParams.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier });
      const me = await (await fetch("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
      const want = (process.env.X_HANDLE || "theagentclippy").replace(/^@/, "").toLowerCase();
      if (me.data?.username?.toLowerCase() !== want) {
        res.end(`You authorised @${me.data?.username}, but the agent account is @${want}. Log into @${want} on x.com and run npm run x:login again.`);
        console.error(`Wrong account: got @${me.data?.username}, expected @${want}. Nothing saved.`);
        return srv.close();
      }
      saveTok({ ...tok, user_id: me.data?.id });
      res.end(`Logged in as @${me.data?.username}. You can close this tab.`);
      console.log(`Saved data/x-token.json for @${me.data?.username} (id ${me.data?.id}). Tokens refresh automatically.`);
      console.log(`\nFor your server, add these two variables:\nX_USER_ID=${me.data?.id}\nX_REFRESH_TOKEN=${tok.refresh_token}\n(then don't run the agent locally too – the refresh token rotates on first use)`);
    } catch (e: any) {
      res.end("Login failed: " + e.message);
      console.error(e);
    }
    srv.close();
  }).listen(3001);
})();
