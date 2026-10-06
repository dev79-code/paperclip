// X (Twitter) API v2. Needs a paid tier for read access (mentions / search).
// Auth: OAuth 2.0 user-context token for the agent's own (clearly labelled "automated") account.
import type { Channel, Incoming } from "./types";
import { loadTok, xAccessToken, xUserId } from "./xauth";
import { config } from "../../config";

const API = "https://api.x.com/2";
const userId = xUserId;

async function x(path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${await xAccessToken()}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`X ${res.status}: ${await res.text()}`);
  return res.json();
}

export const xChannel: Channel = {
  id: "x",
  configured: () => !!(process.env.X_USER_TOKEN || loadTok()) && !!userId(),

  async publish(_venue, title, body) {
    // X has no titles and a 280-char limit: post the headline plus a short disclosure that is never cut.
    // (URLs count as 23 chars on X.)
    const tail = `\n\nI'm an AI agent, a human checks every trade. Live log: ${config.publicUrl}`;
    const room = 280 - (tail.length - config.publicUrl.length + 23);
    const head = title.length > room ? title.slice(0, room - 1) + "…" : title;
    const text = head + tail;
    void body;
    const j = await x("/tweets", { method: "POST", body: JSON.stringify({ text }) });
    return { externalId: j.data.id, url: `https://x.com/i/web/status/${j.data.id}` };
  },

  async fetchReplies(db, venue) {
    const since = db.cursors["x_mentions"];
    const q = new URLSearchParams({
      max_results: "50",
      expansions: "author_id,attachments.media_keys",
      "user.fields": "username",
      "media.fields": "url",
      "tweet.fields": "conversation_id,created_at",
    });
    if (since) q.set("since_id", since);
    const j = await x(`/users/${userId()}/mentions?${q}`);
    const users = new Map<string, string>((j.includes?.users || []).map((u: any) => [u.id, u.username]));
    const media = new Map<string, string>((j.includes?.media || []).map((m: any) => [m.media_key, m.url]));
    const out: Incoming[] = (j.data || []).map((t: any) => ({
      channel: "x",
      venueId: venue.id,
      from: "@" + (users.get(t.author_id) || t.author_id),
      text: t.text,
      threadRef: t.id,
      photos: (t.attachments?.media_keys || []).map((k: string) => media.get(k)).filter(Boolean),
      postId: undefined,
    }));
    if (j.meta?.newest_id) db.cursors["x_mentions"] = j.meta.newest_id;
    return out;
  },

  async reply(threadRef, text) {
    if (text.length > 280) text = text.slice(0, 277) + "…";
    await x("/tweets", { method: "POST", body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: threadRef } }) });
  },
};
