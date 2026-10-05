import { z } from "zod";
import { log, mutate, uid } from "@/lib/db";
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
  const id = await mutate((db) => {
    const id = uid("off_");
    const text = `${b.itemName}: ${b.itemDescription}`;
    db.offers.push({
      id, channel: "web", from: b.contact, threadRef: b.contact, rawText: text,
      itemName: b.itemName, itemDescription: b.itemDescription, photos: b.photoUrl ? [b.photoUrl] : [],
      createdAt: new Date().toISOString(), status: "new", messages: [{ role: "them", text, at: new Date().toISOString() }],
    });
    log(db, "offer", `A web visitor offers: ${b.itemName}`, id);
    return id;
  });
  return Response.json({ ok: true, id });
}
