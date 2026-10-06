import { z } from "zod";
import { submit } from "@/lib/store";
export const runtime = "nodejs";

const Body = z.object({
  itemName: z.string().min(2).max(120),
  itemDescription: z.string().min(5).max(1500),
  photoUrl: z.string().url().optional().or(z.literal("")),
  contact: z.string().min(3).max(120),
});

// naive per-process rate limit
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const recent = (hits.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
  if (recent.length >= 5) return Response.json({ error: "Too many offers – try again later." }, { status: 429 });
  hits.set(ip, [...recent, Date.now()]);

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Please fill in the item, description and contact." }, { status: 400 });
  const b = parsed.data;
  // Queued safely even if an agent round is running right now.
  await submit({ type: "web_offer", itemName: b.itemName, itemDescription: b.itemDescription, photoUrl: b.photoUrl || undefined, contact: b.contact });
  return Response.json({ ok: true });
}
