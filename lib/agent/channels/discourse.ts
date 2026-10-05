// Discourse forums (very common for hobby communities). Ask the admins first – they issue you an
// API key scoped to a bot user, which is the cleanest "permission granted" signal there is.
// venue.target = "<baseUrl>|<categoryId>", credentials in DISCOURSE_SITES JSON.
import type { Channel, Incoming } from "./types";
import type { Venue } from "../../types";

function site(venue?: Venue) {
  const [base, category] = (venue?.target || "").split("|");
  const all = JSON.parse(process.env.DISCOURSE_SITES || "{}") as Record<string, { apiKey: string; username: string }>;
  return { base, category: Number(category), creds: all[base] };
}

async function d(venue: Venue, path: string, init: RequestInit = {}) {
  const { base, creds } = site(venue);
  const res = await fetch(base + path, {
    ...init,
    headers: { "Api-Key": creds.apiKey, "Api-Username": creds.username, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`discourse ${res.status}: ${await res.text()}`);
  return res.json();
}

export const discourseChannel: Channel = {
  id: "discourse",
  configured: () => Object.keys(JSON.parse(process.env.DISCOURSE_SITES || "{}")).length > 0,

  async publish(venue, title, body) {
    const { base, category } = site(venue);
    const j = await d(venue, "/posts.json", { method: "POST", body: JSON.stringify({ title, raw: body, category }) });
    return { externalId: String(j.topic_id), url: `${base}/t/${j.topic_slug}/${j.topic_id}` };
  },

  async fetchReplies(db, venue, posts) {
    const out: Incoming[] = [];
    const { creds } = site(venue);
    for (const p of posts.filter((p) => p.venueId === venue.id && p.externalId).slice(-5)) {
      const key = `discourse_${venue.id}_${p.externalId}`;
      const last = Number(db.cursors[key] || 1);
      const j = await d(venue, `/t/${p.externalId}.json`);
      for (const post of j.post_stream?.posts || []) {
        if (post.post_number <= last || post.username === creds.username) continue;
        out.push({
          channel: "discourse",
          venueId: venue.id,
          postId: p.id,
          from: "@" + post.username,
          text: post.cooked.replace(/<[^>]+>/g, " "),
          threadRef: String(p.externalId),
          photos: [...post.cooked.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m: RegExpMatchArray) => m[1]).slice(0, 6),
        });
        db.cursors[key] = String(post.post_number);
      }
    }
    return out;
  },

  async reply(threadRef, text, venue) {
    await d(venue!, "/posts.json", { method: "POST", body: JSON.stringify({ topic_id: Number(threadRef), raw: text }) });
  },
};
