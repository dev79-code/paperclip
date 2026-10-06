# Paperclip: setup guide

Work through these stages in order. Each one works on its own, so you can stop at any stage.

| Stage | What you get | What you need |
|---|---|---|
| 1. Demo | The dashboard running with simulated communities | Node 20+ |
| 2. Demo with AI | A real AI writing posts and valuing offers, still simulated | An OpenRouter **or** Anthropic key |
| 3. Hosted | A public URL that stays up | A host with a persistent disk |
| 4. Live on X | Real posts and replies | An X developer account |
| 5. More channels | Reddit, forums, email | Approvals and keys per channel |
| 6. Logistics | Real items changing hands | Shipping and escrow accounts |

---

## 1. Run the demo locally (about 5 minutes)

```bash
unzip paperclip-agent.zip && cd paperclip
npm install
cp .env.example .env
npm run build && npm start
```

Open http://localhost:3000. The agent plays itself every 10 seconds. The custodian console is at http://localhost:3000/admin, and the password is `ADMIN_PASSWORD` in `.env`.

* `npm run reset` takes it back to one paperclip.
* `DEMO_TICK_SECONDS=5` makes the demo run faster.

## 2. Add the AI brain (still demo, so nothing is posted)

**Option A: OpenRouter (works fine).**
1. Create an account at openrouter.ai and add credit.
2. Keys → Create key.
3. In `.env`:
   ```
   OPENROUTER_API_KEY=sk-or-...
   OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
   ```
4. The model must support **tool calling**. On OpenRouter's model list, filter by "tools". Claude, GPT and Gemini models work. Cheaper options are fine for testing but value items less well.
5. Price research uses OpenRouter's web search plugin, which is billed per search on top of the model. Set `WEB_SEARCH=0` to save money while testing.

**Option B: Claude API directly.** Get a key at console.anthropic.com and set `ANTHROPIC_API_KEY`. It uses Claude's built-in web search tool.

If both keys are set, OpenRouter wins. You can force one with `LLM_PROVIDER=anthropic` or `LLM_PROVIDER=openrouter`.

Restart with `npm run build && npm start`. The log will now show real reasoning for each offer.

**Rough cost:** each round is about 2–6 model calls, plus 1 web search per new offer. At one round every 15 minutes that's about 100 rounds a day. Check the model's price on OpenRouter and set a credit limit there.

## 3. Host it

The JSON data file needs a persistent disk, so use **Railway**, **Fly.io**, **Render (with a disk)** or a small **VPS**. Vercel won't work unless you switch to Supabase (`supabase/schema.sql`).

Railway example:
1. Push the folder to a **private** GitHub repo, then go to railway.com → New Project → Deploy from GitHub repo.
2. In the service's **Settings**:
   * Set the build command to `npm run build`.
   * Set the start command to `npm run start:all`, which runs the website and the agent in one service.
   * Under Networking, click **Generate Domain**.
3. Right-click the service → **Attach volume**, with mount path `/app/data`.
4. In the **Variables** tab, add your `.env` values, plus `PUBLIC_URL=https://<your domain>` and `DEMO_AUTOPLAY=0`.

Use a strong `ADMIN_PASSWORD`, because it protects /admin, /api/tick and the email webhook.

## 4. Go live on X (the easiest real channel)

The agent's account is **[@theagentclippy](https://x.com/theagentclippy)**, and `X_HANDLE=theagentclippy` is the default. `npm run x:login` refuses to save a login for any other account.

The agent answers **public replies and mentions** and **DMs that people send it first**. It never sends unsolicited DMs. For DMs, the X app's permissions must be **Read and write and Direct message**; set `X_DMS=0` to turn DMs off.

Before connecting it, on @theagentclippy:
- Settings → Your account → Account information → **Automation** → set the managing account to your personal X account. This adds the "Automated" label.
- Bio, for example: *"AI agent trading one red paperclip up to $100k, in public. Barter only · a human checks every trade · live log ↓"*. Put the website URL in the profile's website field.
- Use an original avatar, such as a simple red paperclip. Don't use Microsoft's Clippy character.


1. Create a new X account for the agent. In Settings → Your account → Account information → **Automation**, label it as automated and link your own account as the operator. Put "AI agent" in the bio.
2. Go to developer.x.com, create a project and an app, and choose a plan that can **read mentions**. The free tier can post but can't read replies. Check current pricing there.
3. In the app's **User authentication settings**:
   * Turn on OAuth 2.0 with type **Web App** and permissions **Read and write**.
   * Set the callback URL to `http://localhost:3001/callback`.
   * Copy the **Client ID** and **Client Secret** into `.env` as `X_CLIENT_ID` and `X_CLIENT_SECRET`.
4. Run `npm run x:login`.
   * Make sure you're logged into X as the **agent's** account, open the URL it prints, and click Authorize.
   * It saves `data/x-token.json` with the account ID. Tokens refresh automatically, so you only do this once.
   * On a server, run the login on your own computer. It prints `X_USER_ID` and `X_REFRESH_TOKEN`; add both to Railway's Variables.
5. Set `AGENT_MODE=live` and restart. X is pre-marked as allowed to post because it's your own account.

## 5. More channels

**Reddit**
1. Ask Reddit for API access first. New apps currently need pre-approval: read Reddit's Responsible Builder Policy and submit the request form.
2. Once you're approved, go to reddit.com/prefs/apps, create an app with type **script**, and put its ID and secret, plus the bot account's username and password, in `.env`.
3. **Message the mods** of each subreddit (r/Barter, r/hardwareswap, r/watchexchange, and so on). Explain the project, say that every post discloses it's an AI, and say it posts at most weekly.
4. When a sub says yes, open /admin → Venues and set it to **granted**. Live mode never posts to venues marked "pending".

**Discourse hobby forums** (guitars, cameras, cars…)
1. Email the forum admin. If they agree, ask for a **user API key** for a bot user, e.g. `paperclip_ai`.
2. Add it to `DISCOURSE_SITES={"https://forum.example.com":{"apiKey":"…","username":"paperclip_ai"}}`.
3. In `lib/seed.ts`, set the venue's target to `https://forum.example.com|<tradingCategoryId>`, then run `npm run reset`, or edit `data/db.json`. Mark it granted in /admin.

**Email outreach (for jumps from $1k up)**
1. At resend.com, verify a domain you own and create an API key. Set `RESEND_API_KEY` and `EMAIL_FROM`.
2. Copy `data/leads.example.json` to `data/leads.json` and add brand, collector and shop contacts. Only use business addresses where the contact is relevant.
3. **Inbound replies:** point your provider's inbound webhook at `https://api.<your-domain>/api/webhooks/email`. It has its own secret and never uses the admin password:
   * **Resend:** copy the webhook's signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`. Every request's signature is checked.
   * **Postmark or other providers:** set `EMAIL_WEBHOOK_SECRET` to a long random string, and use `https://inbound:<secret>@api.<your-domain>/api/webhooks/email` as the webhook URL (Basic auth).
   * With neither set, the webhook is switched off.

**eBay prices (optional)**
Create an app at developer.ebay.com, generate an application token for the Browse API, and set `EBAY_APP_TOKEN`. This gives asking prices only; web search fills in sold prices.

## 6. Real-world logistics (before the first real trade)

* **Approvals:** keep `APPROVAL_THRESHOLD_USD` low at first (e.g. 50) so you see every deal in /admin.
* **Shipping:** Shippo or EasyPost (pay-as-you-go labels) for anything posted.
* **Escrow:** Escrow.com for big trades (over about $1k).
* **Checks:**
  * Ask for timestamped photos (the agent already requests them).
  * Use authentication services for watches, cards and sneakers.
  * Check ID with Stripe Identity or Persona for high-value counterparties.
* **Finishing a trade:** when an item arrives as described, click **Item received & verified** in /admin. That completes the trade.
* **Tax and legal:** bartered items can count as taxable income. Talk to an accountant, and to a lawyer if you add a token.

## Checklist

- [ ] Demo runs locally
- [ ] OpenRouter or Anthropic key added, and AI reasoning shows in the log
- [ ] Hosted with a persistent disk and a strong admin password
- [ ] X agent account labelled as automated, API plan can read mentions, token set
- [ ] `AGENT_MODE=live`
- [ ] Mod or admin permission for each Reddit or forum venue, marked granted in /admin
- [ ] Shipping, escrow and approval threshold sorted before the first real trade
