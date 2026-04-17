import type { OhlcBar } from "@/lib/types";

/** Wilder ATR, last value */
function atrWilder(bars: OhlcBar[], period: number): number | undefined {
  if (bars.length < period + 1) return undefined;
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const { h, l, c } = bars[i];
    const prevC = i === 0 ? bars[0].o : bars[i - 1].c;
    tr.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let atr = sum / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

export function natrPct(bars: OhlcBar[], period = 14): number | undefined {
  if (bars.length < 2) return undefined;
  const atr = atrWilder(bars, period);
  const lastClose = bars[bars.length - 1]?.c;
  if (!atr || !lastClose) return undefined;
  return (atr / lastClose) * 100;
}
