// Email outreach via Resend. Outbound: personalised pitches to brands/collectors in data/leads.json.
// Inbound: point Resend inbound (or any provider) at POST /api/webhooks/email – replies become offers.
import fs from "node:fs";
import path from "node:path";
import type { Channel } from "./types";

interface Lead { email: string; name?: string; company?: string; interests?: string[] }

const leadsFile = () => path.join(process.cwd(), "data", "leads.json");
export function loadLeads(): Lead[] {
  try {
    return JSON.parse(fs.readFileSync(leadsFile(), "utf8"));
  } catch {
    return [];
  }
}

export async function sendEmail(to: string, subject: string, text: string, inReplyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text: text + "\n\n—\nNot interested? Reply STOP and Clippy will never email you again.",
      headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : undefined,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
  return (await res.json()).id as string;
}

export const emailChannel: Channel = {
  id: "email",
  configured: () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,

  /** Sends to up to 5 not-yet-contacted leads per call (cooldown keeps this slow). */
  async publish(_venue, title, body) {
    const contactedFile = path.join(process.cwd(), "data", "contacted.json");
    const contacted: string[] = fs.existsSync(contactedFile) ? JSON.parse(fs.readFileSync(contactedFile, "utf8")) : [];
    const batch = loadLeads().filter((l) => !contacted.includes(l.email)).slice(0, 5);
    const ids: string[] = [];
    for (const l of batch) {
      const greet = l.name ? `Hi ${l.name},\n\n` : "Hi there,\n\n";
      ids.push(await sendEmail(l.email, title, greet + body));
      contacted.push(l.email);
    }
    fs.writeFileSync(contactedFile, JSON.stringify(contacted, null, 2));
    return { externalId: ids.join(",") || "none" };
  },

  // Replies arrive by webhook, not polling.
  async fetchReplies() {
    return [];
  },

  async reply(threadRef, text) {
    // threadRef = "<to-address>|<message-id>"
    const [to, mid] = threadRef.split("|");
    await sendEmail(to, "Re: your trade with Clippy", text, mid);
  },
};
