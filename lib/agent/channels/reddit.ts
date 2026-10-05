// Reddit via the official OAuth API ("script" app). Reddit now requires pre-approval for API
// access, and most trading subs need mod permission – keep venue.permission = "pending" until granted.
import type { Channel, Incoming } from "./types";

let cached: { token: string; exp: number } | null = null;

async function token() {
  if (cached && cached.exp > Date.now()) return cached.token;
  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": ua() },
    body: new URLSearchParams({ grant_type: "password", username: process.env.REDDIT_USERNAME!, password: process.env.REDDIT_PASSWORD! }),
  });
  if (!res.ok) throw new Error(`reddit auth ${res.status}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}
const ua = () => process.env.REDDIT_USER_AGENT || "paperclip-agent/0.1";

async function r(path: string, init: RequestInit = {}) {
  const res = await fetch("https://oauth.reddit.com" + path, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, "User-Agent": ua(), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`reddit ${res.status}: ${await res.text()}`);
  return res.json();
}
const form = (o: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(o),
});

export const redditChannel: Channel = {
  id: "reddit",
  configured: () => !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET && process.env.REDDIT_USERNAME),

  async publish(venue, title, body) {
    const j = await r("/api/submit", form({ sr: venue.target, kind: "self", title: title.slice(0, 300), text: body, api_type: "json" }));
    const d = j.json?.data;
    if (!d?.name) throw new Error("reddit submit failed: " + JSON.stringify(j.json?.errors));
    return { externalId: d.name, url: d.url };
  },

  async fetchReplies(db, venue, posts) {
    const out: Incoming[] = [];
    const seen = new Set((db.cursors[`reddit_seen_${venue.id}`] || "").split(",").filter(Boolean));
    // 1) comments on our recent posts in this venue
    for (const p of posts.filter((p) => p.venueId === venue.id && p.externalId).slice(-5)) {
      const id = p.externalId!.replace(/^t3_/, "");
      const j = await r(`/comments/${id}.json?depth=1&limit=100`);
      for (const ch of j[1]?.data?.children || []) {
        const c = ch.data;
        if (!c?.name || seen.has(c.name) || c.author === process.env.REDDIT_USERNAME) continue;
        seen.add(c.name);
        out.push({ channel: "reddit", venueId: venue.id, postId: p.id, from: "u/" + c.author, text: c.body, threadRef: c.name, photos: extractLinks(c.body) });
      }
    }
    // 2) private messages (shared across reddit venues – only pull once per tick via first venue)
    if (!db.cursors["reddit_inbox_tick"] || db.cursors["reddit_inbox_tick"] !== String(db.tickCount)) {
      db.cursors["reddit_inbox_tick"] = String(db.tickCount);
      const inbox = await r("/message/unread?limit=50");
      const read: string[] = [];
      for (const ch of inbox.data?.children || []) {
        const m = ch.data;
        if (m.was_comment) continue; // comment replies are handled above
        read.push(m.name);
        out.push({ channel: "reddit", venueId: venue.id, from: "u/" + m.author, text: `${m.subject}\n${m.body}`, threadRef: m.name, photos: extractLinks(m.body) });
      }
      if (read.length) await r("/api/read_message", form({ id: read.join(",") }));
    }
    db.cursors[`reddit_seen_${venue.id}`] = [...seen].slice(-500).join(",");
    return out;
  },

  async reply(threadRef, text) {
    await r("/api/comment", form({ thing_id: threadRef, text, api_type: "json" }));
  },
};

function extractLinks(s: string) {
  return (s.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)|https?:\/\/(?:i\.)?imgur\.com\/\S+/gi) || []).slice(0, 6);
}
