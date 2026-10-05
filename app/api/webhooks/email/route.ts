import { isAdmin, deny } from "@/lib/admin";
import { log, mutate, uid } from "@/lib/db";
export const runtime = "nodejs";

// Inbound email webhook. Normalise your provider's payload to {from, subject, text, messageId}.
// Protect it with ?key=ADMIN_PASSWORD (or swap in your provider's signature check).
export async function POST(req: Request) {
  if (!isAdmin(req)) return deny();
  const b = await req.json();
  // Accepts a simple {from, subject, text, messageId} shape, Postmark inbound (From/Subject/TextBody/MessageID)
  // and Resend-style ({data: {from, subject, text, email_id}}).
  const d = b.data ?? b;
  const from: string = d.FromFull?.Email || d.From || d.from?.email || d.from;
  const text: string = d.TextBody || d.StrippedTextReply || d.text || d.body || "";
  const mid: string = d.MessageID || d.messageId || d.message_id || d.email_id || "";
  b.subject = d.Subject || d.subject;
  if (!from || !text) return Response.json({ error: "from/text required" }, { status: 400 });
  if (/^\s*stop\b/i.test(text)) return Response.json({ ok: true, unsubscribed: true });
  await mutate((db) => {
    const ref = `${from}|${mid}`;
    const existing = db.offers.find((o) => o.channel === "email" && o.from === from && ["evaluated", "countered"].includes(o.status));
    if (existing) {
      existing.messages.push({ role: "them", text, at: new Date().toISOString() });
      existing.threadRef = ref;
      existing.status = "new";
      return;
    }
    const id = uid("off_");
    db.offers.push({
      id, channel: "email", venueId: "email_brands", from, threadRef: ref, rawText: text,
      itemName: (b.subject || "Email offer").slice(0, 120), itemDescription: text.slice(0, 2000), photos: [],
      createdAt: new Date().toISOString(), status: "new", messages: [{ role: "them", text, at: new Date().toISOString() }],
    });
    log(db, "offer", `Email reply from ${from}`, id);
  });
  return Response.json({ ok: true });
}
