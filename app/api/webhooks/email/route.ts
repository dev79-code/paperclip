import crypto from "node:crypto";
import { submit } from "@/lib/store";
export const runtime = "nodejs";

// Inbound email webhook. Authenticated WITHOUT the admin password:
//  • RESEND_WEBHOOK_SECRET (whsec_…): verifies Resend's signed webhooks (svix-id / svix-timestamp / svix-signature headers)
//  • EMAIL_WEBHOOK_SECRET: a separate shared secret, sent as the password of HTTP Basic auth
//    (e.g. Postmark: https://inbound:SECRET@api.clippy.house/api/webhooks/email), or as an
//    "Authorization: Bearer SECRET" / "x-webhook-secret: SECRET" header.
// With neither set, the webhook is disabled.

const eq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function verifyResend(req: Request, raw: string, secret: string) {
  const id = req.headers.get("svix-id"), ts = req.headers.get("svix-timestamp"), sigs = req.headers.get("svix-signature");
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay protection: 5 minutes
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return sigs.split(" ").some((s) => eq(s.split(",")[1] || "", expected));
}

function verifyShared(req: Request, secret: string) {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && eq(auth.slice(7), secret)) return true;
  if (auth.startsWith("Basic ")) {
    const pass = Buffer.from(auth.slice(6), "base64").toString().split(":").slice(1).join(":");
    if (eq(pass, secret)) return true;
  }
  const h = req.headers.get("x-webhook-secret");
  return !!h && eq(h, secret);
}

export async function POST(req: Request) {
  const raw = await req.text();
  const resendSecret = process.env.RESEND_WEBHOOK_SECRET, shared = process.env.EMAIL_WEBHOOK_SECRET;
  if (!resendSecret && !shared) return Response.json({ error: "email webhook not configured" }, { status: 503 });
  const ok = (resendSecret && verifyResend(req, raw, resendSecret)) || (shared && verifyShared(req, shared));
  if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });

  let b: any;
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Accepts {from, subject, text, messageId}, Postmark inbound (From/Subject/TextBody/MessageID)
  // and Resend-style ({data: {from, subject, text, email_id}}).
  const d = b.data ?? b;
  const from: string = d.FromFull?.Email || d.From || d.from?.email || d.from;
  const text: string = d.TextBody || d.StrippedTextReply || d.text || d.body || "";
  const messageId: string = d.MessageID || d.messageId || d.message_id || d.email_id || "";
  if (!from || !text) return Response.json({ error: "from/text required" }, { status: 400 });
  if (/^\s*stop\b/i.test(text)) return Response.json({ ok: true, unsubscribed: true });

  await submit({ type: "email", from, subject: d.Subject || d.subject, text, messageId });
  return Response.json({ ok: true });
}
