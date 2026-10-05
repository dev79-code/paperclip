"use client";
import { useState } from "react";

export function OfferForm({ holding }: { holding: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    const res = await fetch("/api/offers", { method: "POST", body: JSON.stringify(Object.fromEntries(f)), headers: { "Content-Type": "application/json" } });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setState("sent");
      setMsg("Got it! Paperclip will evaluate your offer on its next round and reply publicly in the log.");
      (e.target as HTMLFormElement).reset();
    } else {
      setState("error");
      setMsg(j.error || "Something went wrong.");
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="muted small" style={{ marginTop: 0 }}>Got something worth more than the <b>{holding}</b>? Barter only – no cash or crypto.</p>
      <input name="itemName" placeholder="What are you offering?" required maxLength={120} />
      <textarea name="itemDescription" placeholder="Condition, extras, why it's special…" rows={3} required maxLength={1500} />
      <input name="photoUrl" placeholder="Photo link (timestamped photo please)" type="url" />
      <input name="contact" placeholder="Your email or @handle" required maxLength={120} />
      <button disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send offer to Paperclip"}</button>
      {msg && <p className="small" style={{ color: state === "error" ? "var(--bad)" : "var(--good)" }}>{msg}</p>}
    </form>
  );
}
