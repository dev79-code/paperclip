import type { ChannelId, DB, Post, Venue } from "../../types";

export interface Incoming {
  channel: ChannelId;
  venueId?: string;
  postId?: string;
  from: string;
  text: string;
  threadRef: string; // id we reply to (tweet id, reddit thing id, discourse topic id, email message id)
  photos: string[];
  /** public link to the reply/mention itself, when there is one (never for DMs or email) */
  url?: string;
  /** DEMO only: ground-truth item, so the simulator doesn't need an LLM */
  demo?: { name: string; description: string; category: string; value: number; liquidity: number; risk: number; story: number };
}

export interface Channel {
  id: ChannelId;
  /** true when credentials are present */
  configured(): boolean;
  publish(venue: Venue, title: string, body: string): Promise<{ externalId: string; url?: string }>;
  /** Return new replies/mentions/DMs since last poll. May use db.cursors. */
  fetchReplies(db: DB, venue: Venue, posts: Post[]): Promise<Incoming[]>;
  reply(threadRef: string, text: string, venue?: Venue): Promise<void>;
}
