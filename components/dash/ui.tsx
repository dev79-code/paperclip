"use client";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------- formatting
export const money = (n: number, compact = false) => {
  if (n == null || isNaN(n)) return "–";
  if (n < 1) return `$${n.toFixed(2)}`;
  if (compact && n >= 10_000) return `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  if (n < 100) return `$${n.toFixed(n % 1 ? 2 : 0)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
};
export const mult = (x: number) => (x >= 1000 ? `${Math.round(x).toLocaleString("en-US")}×` : x >= 10 ? `${x.toFixed(0)}×` : `${x.toFixed(2)}×`);
export const ago = (iso?: string) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${Math.max(1, s | 0)}s ago` : s < 3600 ? `${(s / 60) | 0}m ago` : s < 86400 ? `${(s / 3600) | 0}h ago` : `${(s / 86400) | 0}d ago`;
};

// ---------------------------------------------------------------- category look
const CAT: Record<string, [string, string]> = {
  misc: ["#ff4d5e", "#ff8a5c"],
  collectibles: ["#ffb547", "#ff7a59"],
  electronics: ["#45d0ff", "#8f7bff"],
  computers: ["#45d0ff", "#3ee08f"],
  gaming: ["#8f7bff", "#ff4dc4"],
  instruments: ["#ff8a5c", "#ffb547"],
  music: ["#ff8a5c", "#ffb547"],
  cameras: ["#a3abbd", "#45d0ff"],
  watches: ["#ffd479", "#b7a1ff"],
  jewelry: ["#ffd479", "#ff8ad8"],
  vehicles: ["#3ee08f", "#45d0ff"],
  property: ["#3ee08f", "#ffd479"],
  experience: ["#ff4dc4", "#8f7bff"],
  art: ["#ff4dc4", "#ffb547"],
  home: ["#b7a1ff", "#45d0ff"],
  outdoors: ["#3ee08f", "#ffb547"],
  books: ["#ffb547", "#a3abbd"],
  fashion: ["#ff8ad8", "#ff4d5e"],
};
export const catColors = (c?: string) => CAT[(c || "misc").toLowerCase()] ?? ["#8f7bff", "#45d0ff"];

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export function CatIcon({ c, size = 24 }: { c?: string; size?: number }) {
  const k = (c || "misc").toLowerCase();
  const paths: Record<string, React.ReactNode> = {
    misc: <><path d="M8 12V6.5a3.5 3.5 0 0 1 7 0V16a5 5 0 0 1-10 0V9" /><path d="M11.5 8v7.5a1.5 1.5 0 0 0 3 0" /></>,
    collectibles: <><rect x="5" y="3" width="11" height="15" rx="2" /><path d="M8 21h10a2 2 0 0 0 2-2V7" /><path d="M10.5 8l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L7.5 10.3l2-.3z" /></>,
    electronics: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></>,
    computers: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>,
    gaming: <><path d="M6 8h12a4 4 0 0 1 3.9 4.9l-.8 3.5a2.5 2.5 0 0 1-4.3 1.1L15 15H9l-1.8 2.5a2.5 2.5 0 0 1-4.3-1.1l-.8-3.5A4 4 0 0 1 6 8z" /><path d="M8 10.5v3M6.5 12h3" /><circle cx="16" cy="11" r=".6" /><circle cx="17.5" cy="13" r=".6" /></>,
    instruments: <><path d="M14 3l7 7" /><path d="M18 6l-6.5 6.5" /><path d="M11 9.5c-2-1-4.5-.5-5.5 1.5-.7 1.4-.2 2.3-1.3 3.6-1.5 1.8-.7 4.6 1.6 5.3 1.7.5 2.8-.5 4.3-1 2.2-.7 3.6-2.6 2.4-5" /><circle cx="9" cy="15" r="1.4" /></>,
    music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
    cameras: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>,
    watches: <><circle cx="12" cy="12" r="6" /><path d="M12 9v3l2 1.5" /><path d="M9 6.5 9.6 3h4.8l.6 3.5M9 17.5l.6 3.5h4.8l.6-3.5" /></>,
    vehicles: <><path d="M3 16v-3.5L5.5 7h13L21 12.5V16" /><path d="M3 12.5h18" /><circle cx="7" cy="16.5" r="2" /><circle cx="17" cy="16.5" r="2" /></>,
    property: <><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
    experience: <><path d="M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 1 0-4V4H4z" transform="translate(0 2)" /><path d="M12 9l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" /></>,
    art: <><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5-1.5-2 0-3.5 1-1 3-.5 4.5-1A3 3 0 0 0 21 11c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
    home: <><path d="M6 19v-6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6" /><path d="M5 19h14M8 11V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5" /></>,
    outdoors: <><path d="M3 20 12 4l9 16z" /><path d="M12 20v-6l-3 6M12 14l3 6" /></>,
    books: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 21V5M8 7h7" /></>,
    fashion: <><path d="M6 8h12l1 12H5z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...P} aria-hidden>
      {paths[k] ?? paths.misc}
    </svg>
  );
}

export function Tile({ cat, size = "lg", iconSize }: { cat?: string; size?: "sm" | "md" | "lg"; iconSize?: number }) {
  const [c1, c2] = catColors(cat);
  return (
    <div className={`tile ${size === "lg" ? "" : size}`} style={{ ["--c1" as any]: c1, ["--c2" as any]: c2, color: c1 }}>
      {size === "lg" && <span className="orbit" />}
      <CatIcon c={cat} size={iconSize ?? (size === "lg" ? 76 : size === "md" ? 30 : 20)} />
    </div>
  );
}

// ---------------------------------------------------------------- animated number
export function CountUp({ value, format = money, duration = 1200 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    // animate in log space so $1 → $1,000 feels smooth
    const la = Math.log10(Math.max(a, 0.001)), lb = Math.log10(Math.max(b, 0.001));
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      setShown(Math.pow(10, la + (lb - la) * e));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value, duration]);
  return <>{format(shown)}</>;
}

// ---------------------------------------------------------------- sparkline
export function Spark({ data, w = 92, h = 28, color = "var(--gain)", fill = true }: { data: number[]; w?: number; h?: number; color?: string; fill?: boolean }) {
  if (data.length < 2) data = [data[0] ?? 0, data[0] ?? 0];
  const lo = Math.min(...data), hi = Math.max(...data);
  const span = hi - lo || hi * 0.05 || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - ((v - lo) / span) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const id = "sg" + Math.random().toString(36).slice(2, 8);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", display: "block" }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------- favicon-ish site badge (generic, no logos)
export const SITES: Record<string, { label: string; color: string; letter: string }> = {
  reddit: { label: "Reddit", color: "#c4683c", letter: "r" },
  x: { label: "X", color: "#8a857b", letter: "X" },
  forum: { label: "Forum", color: "#6b86a8", letter: "F" },
  email: { label: "Mail", color: "#6f9a86", letter: "@" },
  ebay: { label: "Sold prices", color: "#b39a5c", letter: "$" },
  web: { label: "Web", color: "#6e6a62", letter: "W" },
  agent: { label: "Notes", color: "#a39e93", letter: "P" },
};
export function Fav({ site }: { site: string }) {
  const s = SITES[site] ?? SITES.web;
  return <span className="fav" style={{ background: s.color }}>{s.letter}</span>;
}
