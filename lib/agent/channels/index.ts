import { config } from "../../config";
import type { ChannelId, Venue } from "../../types";
import { demoChannel } from "./demo";
import { discourseChannel } from "./discourse";
import { emailChannel } from "./email";
import { redditChannel } from "./reddit";
import type { Channel } from "./types";
import { xChannel } from "./x";

const REAL: Partial<Record<ChannelId, Channel>> = {
  x: xChannel,
  reddit: redditChannel,
  discourse: discourseChannel,
  email: emailChannel,
};

/** In demo mode every venue is simulated. In live mode, only configured channels are used. */
export function channelFor(venue: Venue): Channel | null {
  if (config.mode === "demo") return demoChannel;
  const ch = REAL[venue.channel];
  return ch && ch.configured() ? ch : null;
}

/** A venue is usable in live mode only with explicit permission (or where none is required). */
export function venueAllowed(venue: Venue) {
  if (config.mode === "demo") return venue.permission !== "denied";
  return venue.permission === "granted" || venue.permission === "not_required";
}

export type { Channel, Incoming } from "./types";
