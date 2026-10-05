"use client";
import { useEffect, useRef, useState } from "react";
import type { Activity } from "@/lib/types";
import { Fav, SITES } from "./ui";

/** Replays the agent's recorded actions as a live "browser" session. */
const PIPE: Activity["action"][] = ["think", "open", "type", "submit", "scan", "search", "read"];
const LABEL: Record<Activity["action"], string> = {
  think: "planning", open: "opening a page", type: "writing", submit: "posting", scan: "reading replies", search: "looking up prices", read: "valuing an offer",
};

function durationOf(a: Activity) {
  switch (a.action) {
    case "think": return 4200;
    case "open": return 1500;
    case "type": return Math.min(5200, 1500 + (a.detail.length + a.title.length) * 14);
    case "submit": return 2600;
    case "scan": return 2200 + Math.min(4, a.rows?.length ?? 0) * 450;
    case "search": return 1800;
    case "read": return 3600;
  }
}

export function BrowserAgent({ activity, idle }: { activity: Activity[]; idle: boolean }) {
  const seen = useRef<Set<string>>(new Set());
  const queue = useRef<Activity[]>([]);
  const [cur, setCur] = useState<Activity | null>(null);
  const [t, setT] = useState(0); // 0..1 progress through current frame
  const [tabs, setTabs] = useState<string[]>([]);
  const started = useRef(0);
  const dur = useRef(1);
  const first = useRef(true);

  // enqueue new activity
  useEffect(() => {
    const fresh = activity.filter((a) => !seen.current.has(a.id));
    fresh.forEach((a) => seen.current.add(a.id));
    if (first.current) {
      first.current = false;
      queue.current.push(...fresh.slice(-7));
    } else queue.current.push(...fresh);
    // stay close to "now": if the replay falls well behind, skip ahead to the latest few actions
    if (queue.current.length > 14) queue.current = queue.current.slice(-6);
  }, [activity]);

  // player
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const elapsed = now - started.current;
      if (!cur || elapsed >= dur.current) {
        const next = queue.current.shift();
        if (next) {
          const q = queue.current.length;
          const speed = q > 15 ? 0.25 : q > 8 ? 0.4 : q > 3 ? 0.65 : 1;
          dur.current = durationOf(next) * speed;
          started.current = now;
          setCur(next);
          setT(0);
          setTabs((tb) => [next.site, ...tb.filter((s) => s !== next.site)].slice(0, 4));
        } else if (cur) setT(1);
      } else setT(Math.min(1, elapsed / dur.current));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cur]);

  const site = cur?.site ?? "agent";
  const sc = SITES[site] ?? SITES.web;
  const urlFull = cur?.url ?? "paperclip://mind";
  const urlShown = cur && (cur.action === "open" || cur.action === "search") ? urlFull.slice(0, Math.ceil(urlFull.length * Math.min(1, t / 0.3))) : urlFull;
  const step = cur ? PIPE.indexOf(cur.action) : -1;
  const backlog = queue.current.length;

  return (
    <div className="browser">
      <div className="b-chrome">
        <div className="b-lights"><i /><i /><i /></div>
        <div className="b-tabs">
          {(tabs.length ? tabs : ["agent"]).map((s) => (
            <div key={s} className={`b-tab ${s === site ? "on" : ""}`}><Fav site={s} />{SITES[s]?.label ?? s}</div>
          ))}
        </div>
      </div>
      <div className="b-bar">
        <div className="b-nav">‹ › ⟳</div>
        <div className="b-url"><span className="lock">●</span><span className="u">{urlShown}</span></div>
        <div className="b-badge">{idle && !backlog && t >= 1 ? "idle" : "agent at the wheel"}</div>
      </div>
      <div className="b-view">
        {cur && <div key={cur.id + "l"} className="b-load" />}
        <div className="b-scan" />
        {cur ? <Page key={cur.id} a={cur} t={t} color={sc.color} /> : <Waiting />}
      </div>
      <div className="b-status">
        <span className="act">
          {cur ? (t >= 1 && !backlog ? "waiting for the next round" : `${LABEL[cur.action]}…`) : "starting"}
        </span>
        {backlog > 0 && <span>· {backlog} queued</span>}
        <div className="b-steps" aria-hidden>{PIPE.map((p, i) => <i key={p} className={i === step ? "on" : ""} title={p} />)}</div>
      </div>
    </div>
  );
}

function Waiting() {
  return (
    <div className="b-page" style={{ display: "grid", placeItems: "center" }}>
      <div className="mind" style={{ textAlign: "center" }}>
        <span className="muted">Waiting for the agent's first move…</span>
      </div>
    </div>
  );
}



const typed = (s: string, p: number) => s.slice(0, Math.ceil(s.length * Math.max(0, Math.min(1, p))));
const Caret = () => <span className="caret" />;

function SiteHeader({ a, color, sub }: { a: Activity; color: string; sub?: string }) {
  const s = SITES[a.site] ?? SITES.web;
  return (
    <div className="site-h">
      <span className="fav" style={{ background: color }}>{s.letter}</span>
      <div><b>{s.label}</b><br /><span>{sub ?? a.url}</span></div>
    </div>
  );
}

function Page({ a, t, color }: { a: Activity; t: number; color: string }) {
  switch (a.action) {
    case "think": {
      const text = typed(a.detail, t / 0.7);
      return (
        <div className="b-page">
          <div className="site-h"><span className="fav">P</span><div><b>Planning</b><br /><span>notes to self</span></div></div>
          <div className="mind">{text}{t < 0.7 && <Caret />}</div>
          {t > 0.72 && a.rows && a.rows.length > 0 && (
            <>
              <p className="eyebrow" style={{ marginTop: 22 }}>Would love to be offered</p>
              <div className="targets">
                {a.rows.map((r, i) => <div key={i} style={{ animationDelay: `${i * 0.12}s` }}>{r.label}<b>{r.value}</b></div>)}
              </div>
            </>
          )}
        </div>
      );
    }
    case "open":
    case "type":
    case "submit": {
      const isReply = a.title.startsWith("Reply to");
      if (isReply) {
        return (
          <div className="b-page">
            <SiteHeader a={a} color={color} />
            <div className="reply-card hl"><div className="av">{a.title.replace("Reply to ", "").replace(/^[@u/]+/, "").slice(0, 1).toUpperCase()}</div><div><b>{a.title.replace("Reply to ", "")}</b><div className="muted">{a.rows?.[0]?.value ? `Offered: ${a.rows[0].value}` : "Replying in thread"}</div></div></div>
            <div className={`field body focus`} style={{ minHeight: 96 }}>{typed(a.detail, t / 0.8)}{t < 0.8 && <Caret />}</div>
            <span className="fake-btn">Reply</span>
            <Cursor x={t < 0.8 ? 62 : 8} y={t < 0.8 ? 64 : 82} click={t > 0.86} />
          </div>
        );
      }
      const pTitle = a.action === "open" ? 0 : a.action === "submit" ? 1 : t / 0.3;
      const pBody = a.action === "open" ? 0 : a.action === "submit" ? 1 : (t - 0.3) / 0.65;
      const clicking = a.action === "submit" && t > 0.42 && t < 0.6;
      return (
        <div className="b-page">
          <SiteHeader a={a} color={color} sub={a.action === "open" ? "New post" : a.url} />
          <div className={`field ${a.action === "type" && pTitle < 1 ? "focus" : ""}`}>
            {pTitle > 0 ? typed(a.title, pTitle) : <span className="ph">Title</span>}
            {a.action === "type" && pTitle < 1 && <Caret />}
          </div>
          <div className={`field body ${a.action === "type" && pTitle >= 1 ? "focus" : ""}`}>
            {pBody > 0 ? typed(a.detail, pBody) : a.action === "open" ? <><div className="skel" style={{ height: 14, width: "70%" }} /><div className="skel" style={{ height: 14, width: "45%" }} /></> : <span className="ph">Text (optional)</span>}
            {a.action === "type" && pTitle >= 1 && pBody < 1 && <Caret />}
          </div>
          <span className={`fake-btn ${clicking ? "press" : ""}`}>Post</span>
          <Cursor x={a.action === "submit" ? (t < 0.4 ? 60 : 7) : a.action === "open" ? 50 : 70} y={a.action === "submit" ? (t < 0.4 ? 50 : 84) : a.action === "open" ? 18 : 30} click={clicking} />
          {a.action === "submit" && t > 0.6 && <div className="toast">Posted, AI disclosure included</div>}
        </div>
      );
    }
    case "scan": {
      const rows = a.rows ?? [];
      const shown = Math.ceil(rows.length * Math.min(1, t / 0.7));
      return (
        <div className="b-page">
          <SiteHeader a={a} color={color} sub={a.title} />
          {rows.length === 0 ? (
            <div style={{ display: "grid", placeItems: "center", height: 220 }}>
              <div style={{ textAlign: "center" }}>
                <Radar />
                <p className="muted small">{a.detail}</p>
              </div>
            </div>
          ) : (
            rows.slice(0, shown).map((r, i) => (
              <div key={i} className={`reply-card ${i === shown - 1 ? "hl" : ""}`}>
                <div className="av">{r.label.replace(/^[@u/]+/, "").slice(0, 1).toUpperCase()}</div>
                <div><b>{r.label}</b><div>{r.value}</div></div>
              </div>
            ))
          )}
          <Cursor x={80} y={rows.length ? Math.min(78, 22 + shown * 15) : 70} click={false} />
        </div>
      );
    }
    case "search": {
      return (
        <div className="b-page">
          <SiteHeader a={a} color={color} sub="sold listings" />
          <div className="search"><span>{typed(a.title, t / 0.6)}</span>{t < 0.6 && <Caret />}</div>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ animationDelay: `${i * 0.1}s` }} />)}
        </div>
      );
    }
    case "read": {
      const rows = a.rows ?? [];
      const nums = rows.map((r) => Number((r.value || "").replace(/[$,]/g, "")) || 0);
      const max = Math.max(...nums, 1);
      const decision = (a.detail.split(" ")[0] || "").toLowerCase();
      return (
        <div className="b-page">
          <SiteHeader a={a} color={color} sub="sold listings" />
          <div className="search"><span>{a.title}</span></div>
          {rows.map((r, i) => (
            <div key={i} className={`comp ${r.meta === "flag" ? "flag" : ""}`} style={{ animationDelay: `${i * 0.12}s` }}>
              <span>{r.label}{r.meta && r.meta !== "flag" ? <span className="muted small"> · {r.meta}</span> : null}</span>
              <b className="mono">{r.value}</b>
              {r.value && <div className="bar"><i style={{ width: `${(nums[i] / max) * 100}%`, animationDelay: `${i * 0.12}s` }} /></div>}
            </div>
          ))}
          <p className="small muted" style={{ marginTop: 10 }}>{a.detail.split(" · ").slice(2).join(" · ")}</p>
          {["accept", "counter", "reject"].includes(decision) && <div className={`stamp ${decision}`}>{decision.toUpperCase()}</div>}
        </div>
      );
    }
  }
}

function Radar() {
  return (
    <svg width="90" height="90" viewBox="0 0 90 90" aria-hidden>
      <circle cx="45" cy="45" r="40" fill="none" stroke="var(--line-2)" />
      <circle cx="45" cy="45" r="26" fill="none" stroke="var(--line-2)" />
      <circle cx="45" cy="45" r="12" fill="none" stroke="var(--line-2)" />
      <g style={{ transformOrigin: "45px 45px", animation: "spin 2s linear infinite" }}>
        <path d="M45 45 L45 5 A40 40 0 0 1 80 25 Z" fill="var(--ink)" opacity=".08" />
        <line x1="45" y1="45" x2="45" y2="5" stroke="var(--ink-2)" strokeWidth="1" />
      </g>
    </svg>
  );
}

function Cursor({ x, y, click }: { x: number; y: number; click: boolean }) {
  return (
    <div className={`cursor ${click ? "clicking" : ""}`} style={{ left: `${x}%`, top: `${y}%` }}>
      <span className="click" />
      <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L10 21z" fill="#fff" stroke="#0b0d12" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    </div>
  );
}
