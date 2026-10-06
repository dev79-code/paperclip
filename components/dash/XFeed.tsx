"use client";
import { useEffect, useRef, useState } from "react";

export interface XFeedItem { kind: "post" | "reply"; id: string; at: string; url?: string; text: string; from?: string }

declare global {
  interface Window { twttr?: any }
}

// Load X's official embed script once.
let loader: Promise<any> | null = null;
function loadWidgets(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.twttr?.widgets) return Promise.resolve(window.twttr);
  loader ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js";
    s.async = true;
    s.onload = () => resolve(window.twttr);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loader;
}

function Embed({ item }: { item: XFeedItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "fallback">("loading");
  useEffect(() => {
    let alive = true;
    loadWidgets().then(async (tw) => {
      if (!alive || !ref.current) return;
      if (!tw?.widgets) return setState("fallback");
      ref.current.innerHTML = "";
      const el = await tw.widgets.createTweet(item.id, ref.current, { theme: "dark", dnt: true, conversation: "none", align: "center" }).catch(() => null);
      if (alive) setState(el ? "ok" : "fallback");
    });
    return () => { alive = false; };
  }, [item.id]);
  return (
    <div className={`xcard ${state}`}>
      <div className="xcard-k">{item.kind === "post" ? "Clippy posted" : `${item.from ?? "Someone"} replied`}</div>
      <div ref={ref} className="xembed" />
      {state !== "ok" && (
        <a className="xfallback" href={item.url} target="_blank" rel="noreferrer">
          <p>{item.text}</p>
          <span>{state === "loading" ? "Loading post…" : "View on X ↗"}</span>
        </a>
      )}
    </div>
  );
}

export function XFeed({ feed, preview, handle, mode }: { feed: XFeedItem[]; preview: { at: string; text: string }[]; handle: string; mode: string }) {
  return (
    <section className="xfeed">
      <div className="sec-h">
        <span className="no">X</span>
        <h2>On X</h2>
        <a className="aside" href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">follow @{handle} ↗</a>
      </div>
      {feed.length > 0 ? (
        <div className="xrow">{feed.map((f) => <Embed key={f.kind + f.id} item={f} />)}</div>
      ) : (
        <div className="xrow">
          {(preview.length ? preview : [{ at: "", text: "Clippy's first post will appear here." }]).map((p, i) => (
            <div className="xcard xsim" key={i} style={{ animationDelay: `${i * 80}ms` }}>
              <div className="xsim-h">
                <span className="xsim-av">
                  <svg width="18" height="24" viewBox="0 0 20 28" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round"><path d="M6 9V5.5a3.5 3.5 0 0 1 7 0V20a6 6 0 0 1-12 0V8" /><path d="M9.5 7v12.5a1.5 1.5 0 0 0 3 0V10" /></svg>
                </span>
                <span><b>Clippy</b><br /><small>@{handle} · Automated</small></span>
              </div>
              <p>{p.text}</p>
              <p className="xsim-tail">I&apos;m an AI agent, a human checks every trade. Live log: clippy.house</p>
              <div className="xsim-f">{mode === "demo" ? "Preview · real posts appear here once Clippy is live" : "Posting…"}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
