"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartInterval, OhlcBar, TickerSnapshot } from "@/lib/types";
import { bnStyleFromTicker } from "@/lib/exchanges/rest";
import { subscribeKline } from "@/lib/wsKline";
import { fmtVolTable } from "@/lib/format";

function candleTime(t: number) {
  return Math.floor(t / 1000) as UTCTimestamp;
}

function priceFromCoord(
  series: ISeriesApi<"Candlestick">,
  y: number,
): number | null {
  const p = series.coordinateToPrice(y);
  if (p === null || p === undefined) return null;
  return typeof p === "number" ? p : +String(p);
}

function estimateTimeDiff(
  chart: ReturnType<typeof createChart>,
  x1: number,
  x2: number,
  interval: ChartInterval,
): string {
  const ts = chart.timeScale();
  const t1 = ts.coordinateToTime(x1);
  const t2 = ts.coordinateToTime(x2);
  if (t1 !== null && t2 !== null) {
    return formatTimeDiff(Math.abs(Number(t2) - Number(t1)), interval);
  }
  const range = ts.getVisibleRange();
  if (!range) return "";
  const el = chart.chartElement?.();
  const w = el ? el.clientWidth : 0;
  if (w <= 0) return "";
  const secPerPx = (Number(range.to) - Number(range.from)) / w;
  const estSec = Math.abs(x2 - x1) * secPerPx;
  if (!Number.isFinite(estSec) || estSec <= 0) return "";
  return formatTimeDiff(estSec, interval);
}

function intervalToSec(interval: ChartInterval): number {
  const map: Record<ChartInterval, number> = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "1h": 3600,
  };
  return map[interval];
}

function formatTimeDiff(sec: number, interval: ChartInterval): string {
  const bars = Math.round(sec / intervalToSec(interval));
  const barStr = Number.isFinite(bars) && bars > 0 ? `${bars}b` : "";
  let timeStr = "";
  if (sec < 60) timeStr = `${Math.round(sec)}s`;
  else if (sec < 3600) timeStr = `${Math.floor(sec / 60)}m`;
  else {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h < 24) timeStr = m ? `${h}h ${m}m` : `${h}h`;
    else {
      const d = Math.floor(h / 24);
      const rh = h % 24;
      timeStr = `${d}d ${rh}h`;
    }
  }
  return barStr ? `${timeStr} · ${barStr}` : timeStr;
}

interface ChartCellProps {
  ticker: TickerSnapshot;
  interval: ChartInterval;
  fullSize?: boolean;
}

type RulerDrag = { x1: number; y1: number; x2: number; y2: number };
type RulerDone = {
  x: number;
  y: number;
  w: number;
  h: number;
  pct: number;
  timeStr: string;
};

function rectFromDrag(d: RulerDrag) {
  const x = Math.min(d.x1, d.x2);
  const y = Math.min(d.y1, d.y2);
  const w = Math.abs(d.x2 - d.x1);
  const h = Math.abs(d.y2 - d.y1);
  return { x, y, w, h };
}

export default function ChartCell({ ticker, interval, fullSize }: ChartCellProps) {
  const chartMountRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<{
    candles: ISeriesApi<"Candlestick">;
    vol: ISeriesApi<"Histogram">;
  } | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  const [shiftOn, setShiftOn] = useState(false);
  const [paneHover, setPaneHover] = useState(false);
  const [rulerDrag, setRulerDrag] = useState<RulerDrag | null>(null);
  const [rulerDone, setRulerDone] = useState<RulerDone | null>(null);
  const rulerDragRef = useRef<RulerDrag | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    rulerDragRef.current = rulerDrag;
  }, [rulerDrag]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftOn(true);
      if (e.key === "Escape") {
        setRulerDone(null);
        rulerDragRef.current = null;
        setRulerDrag(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftOn(false);
    };
    const onBlur = () => setShiftOn(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const el = chartMountRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#0d1117" },
        textColor: "#848e9c",
        fontSize: 10,
        fontFamily: "var(--font-jetbrains-mono), monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(43, 49, 57, 0.35)" },
        horzLines: { color: "rgba(43, 49, 57, 0.35)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderVisible: false,
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
    });

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    candles.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.22 },
    });

    seriesRef.current = { candles, vol };

    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    });
    ro.observe(el);
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });

    let cancelled = false;
    const sym = bnStyleFromTicker(ticker);

    (async () => {
      try {
        const u = new URL("/api/klines", window.location.origin);
        u.searchParams.set("exchange", ticker.exchange);
        u.searchParams.set("symbol", sym);
        u.searchParams.set("interval", interval);
        u.searchParams.set("limit", "180");
        const res = await fetch(u.toString());
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { bars?: OhlcBar[] };
        const bars = j.bars ?? [];
        const cData = bars.map((b) => ({
          time: candleTime(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        }));
        const vData = bars.map((b) => {
          const up = b.c >= b.o;
          return {
            time: candleTime(b.t),
            value: b.v ?? 0,
            color: up ? "rgba(14, 203, 129, 0.35)" : "rgba(246, 70, 93, 0.35)",
          };
        });
        candles.setData(cData);
        vol.setData(vData);
        chart.timeScale().scrollToRealTime();
      } catch {
        /* ignore */
      }
    })();

    const unsub = subscribeKline(
      ticker.exchange,
      sym,
      interval,
      (b) => {
        const time = candleTime(b.t);
        const up = b.c >= b.o;
        candles.update({
          time,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        });
        vol.update({
          time,
          value: b.v ?? 0,
          color: up ? "rgba(14, 203, 129, 0.35)" : "rgba(246, 70, 93, 0.35)",
        });
      },
    );

    return () => {
      cancelled = true;
      unsub();
      ro.disconnect();
      chart.remove();
      seriesRef.current = null;
      chartRef.current = null;
    };
  }, [ticker.id, ticker.exchange, interval]);

  const copySymbol = useCallback(async () => {
    const text = bnStyleFromTicker(ticker);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }, [ticker]);

  const xyInPane = (e: React.PointerEvent | PointerEvent) => {
    const pane = paneRef.current;
    if (!pane) return { x: 0, y: 0 };
    const r = pane.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPanePointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.shiftKey && e.button === 0 && rulerDone) {
      setRulerDone(null);
      rulerDragRef.current = null;
      setRulerDrag(null);
      return;
    }
    if (!e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = xyInPane(e);
    setRulerDone(null);
    const start = { x1: x, y1: y, x2: x, y2: y };
    rulerDragRef.current = start;
    setRulerDrag(start);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPanePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rulerDrag) return;
    if (!(e.buttons & 1)) return;
    if (!e.shiftKey) return;
    const { x, y } = xyInPane(e);
    setRulerDrag((d) => {
      if (!d) return d;
      const next = { ...d, x2: x, y2: y };
      rulerDragRef.current = next;
      return next;
    });
  };

  const onPanePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    try {
      if (typeof el.hasPointerCapture === "function" && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    if (e.button !== 0) return;
    const series = seriesRef.current?.candles;
    const drag = rulerDragRef.current;
    if (!drag || !series) {
      rulerDragRef.current = null;
      setRulerDrag(null);
      return;
    }
    const { x1, y1, x2, y2 } = drag;
    const pStart = priceFromCoord(series, y1);
    const pEnd = priceFromCoord(series, y2);
    rulerDragRef.current = null;
    setRulerDrag(null);
    if (pStart === null || pEnd === null || pStart <= 0) return;
    const rect = rectFromDrag(drag);
    if (rect.w < 4 && rect.h < 4) return;
    const pct = ((pEnd - pStart) / pStart) * 100;
    const chart = chartRef.current;
    const timeStr = chart ? estimateTimeDiff(chart, x1, x2, interval) : "";
    setRulerDone({ ...rect, pct, timeStr });
  };

  const ch = ticker.changePct24h;
  const chNeg = ch < 0;
  const natrStr =
    ticker.natrPct != null && Number.isFinite(ticker.natrPct)
      ? ticker.natrPct.toFixed(1)
      : "—";
  const volStr = fmtVolTable(ticker.quoteVolume24h);

  const dragRect = rulerDrag ? rectFromDrag(rulerDrag) : null;

  /* eslint-disable react-hooks/refs */
  const dragInfo = useMemo(() => {
    if (!rulerDrag || !seriesRef.current?.candles) return null;
    const series = seriesRef.current.candles;
    const { y1, y2, x1, x2 } = rulerDrag;
    const pStart = priceFromCoord(series, y1);
    const pEnd = priceFromCoord(series, y2);
    if (pStart === null || pEnd === null || pStart <= 0) return null;
    const pct = ((pEnd - pStart) / pStart) * 100;
    const chart = chartRef.current;
    const timeStr = chart ? estimateTimeDiff(chart, x1, x2, interval) : "";
    return { pct, timeStr };
  }, [rulerDrag, interval]);
  /* eslint-enable react-hooks/refs */

  const dragPct = dragInfo?.pct ?? null;
  const dragTimeStr = dragInfo?.timeStr ?? "";
  const rulerHint = shiftOn && paneHover;

  const rulerColor = (pct: number | null) => {
    if (pct === null) return { stroke: "rgba(139,92,246,0.6)", fill: "rgba(139,92,246,0.12)", text: "#a78bfa" };
    const pos = pct >= 0;
    return {
      stroke: pos ? "#8b5cf6" : "#f87171",
      fill: pos ? "rgba(139,92,246,0.12)" : "rgba(248,113,113,0.12)",
      text: pos ? "#a78bfa" : "#f87171",
    };
  };

  const labelMid =
    rulerDone &&
    ({
      x: rulerDone.x + rulerDone.w / 2,
      y: rulerDone.y + rulerDone.h / 2,
    } as const);

  const dragLabelMid = dragRect && dragPct !== null
    ? { x: dragRect.x + dragRect.w / 2, y: dragRect.y + dragRect.h / 2 }
    : null;

  return (
    <div className={`flex min-h-0 flex-1 flex-col rounded border border-zinc-800/80 bg-[#0d1117] ${fullSize ? "h-full" : ""}`}>
      <div className="flex shrink-0 flex-col gap-1 border-b border-zinc-800/80 px-1.5 py-1 text-[10px]">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            title="Копировать символ"
            onClick={() => void copySymbol()}
            className={`flex shrink-0 items-center gap-1 rounded bg-zinc-800/90 px-1.5 py-0.5 font-semibold text-zinc-100 hover:bg-zinc-700/90 ${fullSize ? "text-sm" : ""}`}
          >
            <span className="text-zinc-500">◇</span>
            {ticker.label}
            {copied ? <span className="text-emerald-400">✓</span> : null}
          </button>
          <span
            className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 tabular-nums ${
              chNeg
                ? "bg-red-950/55 text-red-300"
                : "bg-emerald-950/40 text-emerald-300"
            }`}
            title="Изменение 24ч"
          >
            <span className="text-[9px] opacity-80">〜</span>
            {ch >= 0 ? "+" : ""}
            {ch.toFixed(1)}%
          </span>
          <span
            className="flex items-center gap-0.5 rounded bg-zinc-800/90 px-1.5 py-0.5 tabular-nums text-zinc-300"
            title="Range 24ч"
          >
            <span className="text-[9px]">↕</span>
            {ticker.rangePct24h.toFixed(1)}%
          </span>
          <span
            className="flex items-center gap-0.5 rounded bg-violet-950/40 px-1.5 py-0.5 tabular-nums text-violet-300"
            title="NATR 5m/14"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
              <path d="M3 12h4l3-9 4 18 3-9h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {natrStr}
          </span>
          <span
            className="flex items-center gap-0.5 rounded bg-zinc-800/90 px-1.5 py-0.5 tabular-nums text-zinc-400"
            title="Объём 24ч"
          >
            <span className="text-[9px]">▮</span>
            {volStr}
          </span>
          <span className="ml-auto shrink-0 text-zinc-600">{interval}</span>
        </div>
      </div>
      <div
        ref={paneRef}
        className={`relative flex-1 ${fullSize ? "min-h-[400px]" : "min-h-[140px]"}`}
        onMouseEnter={() => setPaneHover(true)}
        onMouseLeave={() => {
          setPaneHover(false);
          rulerDragRef.current = null;
          setRulerDrag(null);
        }}
        onPointerDownCapture={onPanePointerDownCapture}
        onPointerMove={onPanePointerMove}
        onPointerUp={onPanePointerUp}
        onPointerCancel={() => {
          rulerDragRef.current = null;
          setRulerDrag(null);
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-4xl font-black tracking-tighter text-zinc-800/40"
          aria-hidden
        >
          {ticker.label.split(" ")[0]}
        </div>
        <div ref={chartMountRef} className="absolute inset-0" />
        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full touch-none select-none"
          aria-hidden
        >
          {dragRect && (dragRect.w > 1 || dragRect.h > 1) ? (() => {
            const c = rulerColor(dragPct);
            const cx = dragRect.x + dragRect.w / 2;
            const cy = dragRect.y + dragRect.h / 2;
            const aS = Math.min(5, dragRect.h / 5);
            const aSH = Math.min(5, dragRect.w / 5);
            const up = dragPct !== null && dragPct >= 0;
            return (
              <g>
                <rect
                  x={dragRect.x}
                  y={dragRect.y}
                  width={dragRect.w}
                  height={dragRect.h}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
                <line
                  x1={cx}
                  y1={dragRect.y + dragRect.h}
                  x2={cx}
                  y2={dragRect.y}
                  stroke={c.text}
                  strokeWidth={0.7}
                  opacity={0.5}
                />
                {dragRect.h > 8 && (
                  <polygon
                    points={`${cx},${up ? dragRect.y : dragRect.y + dragRect.h} ${cx - aS},${up ? dragRect.y + aS : dragRect.y + dragRect.h - aS} ${cx + aS},${up ? dragRect.y + aS : dragRect.y + dragRect.h - aS}`}
                    fill={c.text}
                    opacity={0.65}
                  />
                )}
                <line
                  x1={dragRect.x}
                  y1={cy}
                  x2={dragRect.x + dragRect.w}
                  y2={cy}
                  stroke={c.text}
                  strokeWidth={0.7}
                  opacity={0.5}
                />
                {dragRect.w > 8 && (
                  <polygon
                    points={`${dragRect.x + dragRect.w},${cy} ${dragRect.x + dragRect.w - aSH},${cy - aSH} ${dragRect.x + dragRect.w - aSH},${cy + aSH}`}
                    fill={c.text}
                    opacity={0.65}
                  />
                )}
              </g>
            );
          })() : null}
          {dragRect && dragLabelMid && dragPct !== null ? (() => {
            const c = rulerColor(dragPct);
            const hasTime = dragTimeStr.length > 0;
            const charW = 7;
            const pctChars = (dragPct >= 0 ? 1 : 0) + dragPct.toFixed(3).length + 1;
            const pctW = pctChars * charW + 12;
            const timeW = hasTime ? dragTimeStr.length * charW + 12 : 0;
            const lw = Math.max(pctW, timeW, 60);
            const lh = hasTime ? 36 : 20;
            return (
              <g>
                <rect
                  x={dragLabelMid.x - lw / 2}
                  y={dragLabelMid.y - lh / 2 - 2}
                  width={lw}
                  height={lh}
                  rx={4}
                  fill="rgba(11,14,17,0.94)"
                  stroke={c.text}
                  strokeWidth={0.6}
                />
                <text
                  x={dragLabelMid.x}
                  y={dragLabelMid.y - (hasTime ? 6 : 1)}
                  textAnchor="middle"
                  fill={c.text}
                  fontSize="11"
                  fontFamily="var(--font-jetbrains-mono), monospace"
                >
                  {dragPct >= 0 ? "+" : ""}
                  {dragPct.toFixed(3)}%
                </text>
                {hasTime && (
                  <text
                    x={dragLabelMid.x}
                    y={dragLabelMid.y + 10}
                    textAnchor="middle"
                    fill="#a1a1aa"
                    fontSize="11"
                    fontFamily="var(--font-jetbrains-mono), monospace"
                  >
                    {dragTimeStr}
                  </text>
                )}
              </g>
            );
          })() : null}
          {rulerDone ? (() => {
            const c = rulerColor(rulerDone.pct);
            const cx = rulerDone.x + rulerDone.w / 2;
            const cy = rulerDone.y + rulerDone.h / 2;
            const aS = Math.min(5, rulerDone.h / 5);
            const aSH = Math.min(5, rulerDone.w / 5);
            const up = rulerDone.pct >= 0;
            return (
              <g>
                <rect
                  x={rulerDone.x}
                  y={rulerDone.y}
                  width={rulerDone.w}
                  height={rulerDone.h}
                  fill={c.fill.replace("0.12", "0.14")}
                  stroke={c.stroke}
                  strokeWidth={1}
                />
                <line
                  x1={cx}
                  y1={rulerDone.y + rulerDone.h}
                  x2={cx}
                  y2={rulerDone.y}
                  stroke={c.text}
                  strokeWidth={0.7}
                  opacity={0.5}
                />
                {rulerDone.h > 8 && (
                  <polygon
                    points={`${cx},${up ? rulerDone.y : rulerDone.y + rulerDone.h} ${cx - aS},${up ? rulerDone.y + aS : rulerDone.y + rulerDone.h - aS} ${cx + aS},${up ? rulerDone.y + aS : rulerDone.y + rulerDone.h - aS}`}
                    fill={c.text}
                    opacity={0.65}
                  />
                )}
                <line
                  x1={rulerDone.x}
                  y1={cy}
                  x2={rulerDone.x + rulerDone.w}
                  y2={cy}
                  stroke={c.text}
                  strokeWidth={0.7}
                  opacity={0.5}
                />
                {rulerDone.w > 8 && (
                  <polygon
                    points={`${rulerDone.x + rulerDone.w},${cy} ${rulerDone.x + rulerDone.w - aSH},${cy - aSH} ${rulerDone.x + rulerDone.w - aSH},${cy + aSH}`}
                    fill={c.text}
                    opacity={0.65}
                  />
                )}
              </g>
            );
          })() : null}
          {rulerDone && labelMid ? (() => {
            const c = rulerColor(rulerDone.pct);
            const hasTime = rulerDone.timeStr.length > 0;
            const charW = 7;
            const pctChars = (rulerDone.pct >= 0 ? 1 : 0) + rulerDone.pct.toFixed(3).length + 1;
            const pctW = pctChars * charW + 12;
            const timeW = hasTime ? rulerDone.timeStr.length * charW + 12 : 0;
            const lw = Math.max(pctW, timeW, 60);
            const lh = hasTime ? 36 : 20;
            return (
              <g>
                <rect
                  x={labelMid.x - lw / 2}
                  y={labelMid.y - lh / 2 - 2}
                  width={lw}
                  height={lh}
                  rx={4}
                  fill="rgba(11,14,17,0.94)"
                  stroke={c.text}
                  strokeWidth={0.6}
                />
                <text
                  x={labelMid.x}
                  y={labelMid.y - (hasTime ? 6 : 1)}
                  textAnchor="middle"
                  fill={c.text}
                  fontSize="11"
                  fontFamily="var(--font-jetbrains-mono), monospace"
                >
                  {rulerDone.pct >= 0 ? "+" : ""}
                  {rulerDone.pct.toFixed(3)}%
                </text>
                {hasTime && (
                  <text
                    x={labelMid.x}
                    y={labelMid.y + 10}
                    textAnchor="middle"
                    fill="#a1a1aa"
                    fontSize="11"
                    fontFamily="var(--font-jetbrains-mono), monospace"
                  >
                    {rulerDone.timeStr}
                  </text>
                )}
              </g>
            );
          })() : null}
        </svg>
        {rulerHint ? (
          <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-zinc-500">
            Shift + ЛКМ — линейка · ЛКМ без Shift — сброс · Esc
          </div>
        ) : null}
      </div>
    </div>
  );
}
