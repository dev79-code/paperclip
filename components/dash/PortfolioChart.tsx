"use client";
import { useMemo, useRef, useState } from "react";
import { money } from "./ui";

interface P { tick: number; value: number }
const W = 760, H = 280, L = 58, R = 18, T = 18, B = 30;

export function PortfolioChart({ history, goal, trades }: { history: P[]; goal: number; trades: { tick: number; name: string; mult: number }[] }) {
  const [scale, setScale] = useState<"log" | "lin">("log");
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const pts = history.length ? history : [{ tick: 0, value: 0.01 }];
  const t0 = pts[0].tick, t1 = Math.max(pts[pts.length - 1].tick, t0 + 10);
  const maxV = scale === "log" ? 150_000 : Math.max(goal * 1.1, ...pts.map((p) => p.value));
  const minV = scale === "log" ? 0.01 : 0;
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) =>
    scale === "log"
      ? T + (1 - (Math.log10(Math.max(v, minV)) - Math.log10(minV)) / (Math.log10(maxV) - Math.log10(minV))) * (H - T - B)
      : T + (1 - (v - minV) / (maxV - minV)) * (H - T - B);

  const { line, area, len } = useMemo(() => {
    let d = "";
    pts.forEach((p, i) => { d += i === 0 ? `M${x(p.tick)},${y(p.value)}` : `H${x(p.tick)}V${y(p.value)}`; });
    const lastX = x(pts[pts.length - 1].tick);
    // rough path length for the draw animation
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.abs(x(pts[i].tick) - x(pts[i - 1].tick)) + Math.abs(y(pts[i].value) - y(pts[i - 1].value));
    return { line: d, area: `${d}H${lastX}V${H - B}H${x(pts[0].tick)}Z`, len: Math.ceil(len) + 10 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, scale]);

  const ticks = scale === "log" ? [0.01, 1, 100, 10_000] : [0, goal / 4, goal / 2, (goal * 3) / 4];
  const last = pts[pts.length - 1];
  const h = hover != null ? pts[hover] : null;

  function onMove(e: React.MouseEvent) {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(x(p.tick) - sx); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  }

  return (
    <div className="chart">
      <div className="panel-h" style={{ marginBottom: 6 }}>
        <span className="tag">value of the item held, by round</span>
        <div className="seg" role="tablist">
          <button className={scale === "log" ? "on" : ""} onClick={() => setScale("log")}>LOG</button>
          <button className={scale === "lin" ? "on" : ""} onClick={() => setScale("lin")}>LINEAR</button>
        </div>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Value of the item held, per round" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="pf-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ece7dd" stopOpacity=".09" />
            <stop offset="1" stopColor="#ece7dd" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={L - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">{money(t, true)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(goal)} y2={y(goal)} stroke="var(--ink-3)" strokeDasharray="2 4" />
        <text x={L + 6} y={y(goal) - 7} fontSize="11" fill="var(--ink-2)" fontFamily="var(--mono)">goal {money(goal, true)}</text>
        <g key={trades.length + scale}>
          <path d={area} fill="url(#pf-fill)" style={{ animation: "fade 1.2s ease both" }} />
          <path className="line-path" d={line} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" style={{ ["--len" as any]: len }} />
        </g>
        {trades.map((tr, i) => {
          const p = pts.find((q) => q.tick >= tr.tick) ?? last;
          return <circle key={i} cx={x(p.tick)} cy={y(p.value)} r="3.2" fill="var(--bg)" stroke="var(--ink)" strokeWidth="1.5" />;
        })}
        <circle cx={x(last.tick)} cy={y(last.value)} r="5" fill="var(--accent)" />
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.tick)} x2={x(h.tick)} y1={T} y2={H - B} stroke="var(--ink-3)" />
            <circle cx={x(h.tick)} cy={y(h.value)} r="4" fill="var(--ink)" />
          </g>
        )}
        <text x={L} y={H - 8} fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">round {t0}</text>
        <text x={W - R} y={H - 8} textAnchor="end" fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">round {last.tick}</text>
      </svg>
      {h && hover != null && (
        <div className="tip" style={{ left: `${(x(h.tick) / W) * 100}%`, top: `${(y(h.value) / H) * 100}%` }}>
          <b>{money(h.value)}</b> · round {h.tick}
          {trades.find((tr) => tr.tick === h.tick) && <><br /><span className="muted">traded into {trades.find((tr) => tr.tick === h.tick)!.name}</span></>}
        </div>
      )}
    </div>
  );
}
