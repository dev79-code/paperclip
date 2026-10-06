// Core domain types for the Paperclip agent.

export type ChannelId = "x" | "reddit" | "discourse" | "email" | "web" | "demo";

export interface Item {
  id: string;
  name: string;
  description: string;
  category: string;
  estValueUsd: number;
  valueLow: number;
  valueHigh: number;
  valuationNotes: string;
  imageUrl?: string;
  /** what price research found when this item was valued (sold listings / web search) */
  marketNotes?: string;
  acquiredAt: string;
  acquiredFrom?: string; // handle of counterparty
}

/** A community / place the agent can post trade requests in. */
export interface Venue {
  id: string;
  channel: ChannelId;
  name: string; // e.g. "r/Barter", "@paperclip on X", "guitar-forum.example"
  target: string; // subreddit name, discourse base url + category id, email list id...
  categories: string[]; // item categories this venue is good for ("*" = any)
  minValueUsd: number;
  maxValueUsd: number;
  cooldownHours: number; // never post more often than this
  permission: "granted" | "pending" | "not_required" | "denied";
  formatHint: string; // community-specific post format rules
  lastPostedAt?: string;
  stats: { posts: number; offers: number; accepted: number };
}

export interface Post {
  id: string;
  venueId: string;
  channel: ChannelId;
  externalId?: string;
  url?: string;
  title: string;
  body: string;
  itemId: string;
  createdAt: string;
}

export type OfferStatus =
  | "new"
  | "evaluated"
  | "countered"
  | "rejected"
  | "awaiting_approval"
  | "accepted"
  | "completed"
  | "expired";

export interface Offer {
  id: string;
  channel: ChannelId;
  venueId?: string;
  postId?: string;
  from: string; // handle / email
  threadRef?: string; // external id used to reply
  rawText: string;
  itemName: string;
  itemDescription: string;
  photos: string[];
  /** public link to where the offer was made (the reply/comment), if any */
  sourceUrl?: string;
  createdAt: string;
  status: OfferStatus;
  evaluation?: Evaluation;
  messages: { role: "them" | "agent"; text: string; at: string }[];
  /** DEMO only: simulator ground truth */
  sim?: { name: string; description: string; category: string; value: number; liquidity: number; risk: number; story: number };
  updatedTick?: number;
}

export interface Evaluation {
  estValueUsd: number;
  valueLow: number;
  valueHigh: number;
  category: string;
  liquidity: number; // 0-1 how easy to trade on
  risk: number; // 0-1 fraud / misdescription risk
  story: number; // 0-1 virality / narrative value
  score: number;
  decision: "accept" | "counter" | "reject";
  reasoning: string;
  replyText: string;
  policyFlags: string[];
  marketNotes?: string;
}

export interface Trade {
  id: string;
  number: number;
  fromItemId: string;
  toItemId: string;
  offerId: string;
  counterparty: string;
  channel: ChannelId;
  multiplier: number;
  rationale: string;
  completedAt: string;
}

export type LogKind = "think" | "post" | "offer" | "evaluate" | "reply" | "trade" | "policy" | "error" | "system";

export interface LogEvent {
  id: string;
  at: string;
  kind: LogKind;
  text: string;
  ref?: string;
}

/** One step of what the agent is "doing on screen" – drives the live browser view. */
export type Site = "reddit" | "x" | "forum" | "email" | "ebay" | "web" | "agent";
export interface Activity {
  id: string;
  at: string;
  site: Site;
  url: string;
  action: "open" | "type" | "submit" | "scan" | "search" | "read" | "think";
  title: string;
  detail: string;
  /** search results / comps / replies to render on the mock page */
  rows?: { label: string; value?: string; meta?: string }[];
}

export interface WatchItem {
  id: string;
  name: string;
  category: string;
  kind: "offer" | "target";
  from?: string;
  offerId?: string;
  status?: string;
  estValueUsd: number;
  multiplier: number;
  history: number[]; // value estimate per round
  firstSeenTick: number;
}

export interface DB {
  goalUsd: number;
  currentItemId: string;
  items: Item[];
  venues: Venue[];
  posts: Post[];
  offers: Offer[];
  trades: Trade[];
  log: LogEvent[];
  cursors: Record<string, string>; // per-channel "since" markers for reply polling
  tickCount: number;
  activity: Activity[];
  watchlist: WatchItem[];
  history: { tick: number; at: string; value: number }[];
  lastTickAt?: string;
}
