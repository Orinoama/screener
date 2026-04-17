import type { ExchangeId, OhlcBar, TickerSnapshot, UnifiedInstrument } from "@/lib/types";
import { natrPct } from "@/lib/natr";

const USDT_PERP_SUFFIX = /USDT$/i;

function bnLabel(sym: string) {
  return sym.replace(/USDT$/i, "");
}

function toOkxSwapInstId(bnStyle: string) {
  const base = bnStyle.replace(/USDT$/i, "");
  return `${base}-USDT-SWAP`;
}

function rangePct(high: number, low: number, open: number) {
  return open ? ((high - low) / open) * 100 : 0;
}

function makeInstrument(exchange: ExchangeId, nativeSymbol: string, label: string): UnifiedInstrument {
  return {
    id: `${exchange}:futures:${nativeSymbol}`,
    exchange,
    market: "futures",
    nativeSymbol,
    label,
  };
}

export function chartNativeSymbol(ex: ExchangeId, bnStyle: string): string {
  if (ex === "okx") return toOkxSwapInstId(bnStyle);
  return bnStyle;
}

/** Binance USDT-M perpetual 24h */
export async function fetchBinanceUsdm24h(): Promise<TickerSnapshot[]> {
  const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", {
    next: { revalidate: 15 },
  });
  if (!res.ok) throw new Error(`Binance futures 24h ${res.status}`);
  const rows = (await res.json()) as Array<{
    symbol: string;
    lastPrice: string;
    openPrice: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
    quoteVolume: string;
    priceChangePercent: string;
    count: string;
  }>;
  const out: TickerSnapshot[] = [];
  for (const r of rows) {
    if (!USDT_PERP_SUFFIX.test(r.symbol)) continue;
    const last = +r.lastPrice;
    const open = +r.openPrice;
    const high = +r.highPrice;
    const low = +r.lowPrice;
    if (!last || !open) continue;
    const inst = makeInstrument("binance", r.symbol, `${bnLabel(r.symbol)} BN-F`);
    out.push({
      ...inst,
      last,
      open24h: open,
      high24h: high,
      low24h: low,
      quoteVolume24h: +r.quoteVolume,
      baseVolume24h: +r.volume,
      changePct24h: +r.priceChangePercent,
      rangePct24h: rangePct(high, low, open),
      trades24h: +r.count,
    });
  }
  return out;
}

/** Bybit USDT linear perpetual */
export async function fetchBybitLinear24h(): Promise<TickerSnapshot[]> {
  const res = await fetch(
    "https://api.bybit.com/v5/market/tickers?category=linear",
    { next: { revalidate: 15 } },
  );
  if (!res.ok) throw new Error(`Bybit linear 24h ${res.status}`);
  const j = (await res.json()) as {
    result?: { list?: Array<Record<string, string>> };
  };
  const list = j.result?.list ?? [];
  const out: TickerSnapshot[] = [];
  for (const r of list) {
    const sym = r.symbol ?? "";
    if (!USDT_PERP_SUFFIX.test(sym)) continue;
    const last = +(r.lastPrice ?? "0");
    const open = +(r.prevPrice24h ?? r.openPrice ?? "0") || last;
    const high = +(r.highPrice24h ?? "0");
    const low = +(r.lowPrice24h ?? "0");
    if (!last) continue;
    const inst = makeInstrument("bybit", sym, `${bnLabel(sym)} BB-F`);
    const turnover = +(r.turnover24h ?? "0");
    const volBase = +(r.volume24h ?? "0");
    const ch =
      open && last
        ? ((last - open) / open) * 100
        : +(r.price24hPcnt ?? "0") * 100;
    out.push({
      ...inst,
      last,
      open24h: open,
      high24h: high,
      low24h: low,
      quoteVolume24h: turnover,
      baseVolume24h: volBase,
      changePct24h: ch,
      rangePct24h: rangePct(high, low, open),
      trades24h: 0,
    });
  }
  return out;
}

/** OKX USDT SWAP perpetual */
export async function fetchOkxSwap24h(): Promise<TickerSnapshot[]> {
  const res = await fetch(
    "https://www.okx.com/api/v5/market/tickers?instType=SWAP",
    { next: { revalidate: 15 } },
  );
  if (!res.ok) throw new Error(`OKX SWAP 24h ${res.status}`);
  const j = (await res.json()) as {
    data?: Array<{
      instId: string;
      last: string;
      open24h: string;
      high24h: string;
      low24h: string;
      volCcy24h: string;
      vol24h: string;
    }>;
  };
  const list = j.data ?? [];
  const out: TickerSnapshot[] = [];
  for (const r of list) {
    if (!r.instId.endsWith("-USDT-SWAP")) continue;
    const last = +r.last;
    const open = +r.open24h || last;
    const high = +r.high24h;
    const low = +r.low24h;
    if (!last) continue;
    const base = r.instId.replace(/-USDT-SWAP$/i, "");
    const inst = makeInstrument("okx", r.instId, `${base} OK-F`);
    const qv = +r.volCcy24h;
    const ch = open ? ((last - open) / open) * 100 : 0;
    out.push({
      ...inst,
      last,
      open24h: open,
      high24h: high,
      low24h: low,
      quoteVolume24h: qv,
      baseVolume24h: +r.vol24h,
      changePct24h: ch,
      rangePct24h: rangePct(high, low, open),
      trades24h: 0,
    });
  }
  return out;
}

const INTERVAL_MAP: Record<string, Record<ExchangeId, string>> = {
  "1m": { binance: "1m", bybit: "1", okx: "1m" },
  "3m": { binance: "3m", bybit: "3", okx: "3m" },
  "5m": { binance: "5m", bybit: "5", okx: "5m" },
  "15m": { binance: "15m", bybit: "15", okx: "15m" },
  "1h": { binance: "1h", bybit: "60", okx: "1H" },
};

export function intervalFor(ex: ExchangeId, i: string) {
  return INTERVAL_MAP[i]?.[ex] ?? INTERVAL_MAP["5m"][ex];
}

export async function fetchKlines(
  ex: ExchangeId,
  bnStyleSymbol: string,
  interval: string,
  limit = 80,
): Promise<OhlcBar[]> {
  if (ex === "binance") {
    const int = intervalFor("binance", interval);
    const u = new URL("https://fapi.binance.com/fapi/v1/klines");
    u.searchParams.set("symbol", bnStyleSymbol);
    u.searchParams.set("interval", int);
    u.searchParams.set("limit", String(limit));
    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) return [];
    const rows = (await res.json()) as [
      number,
      string,
      string,
      string,
      string,
      string,
    ][];
    return rows.map((k) => ({
      t: k[0],
      o: +k[1],
      h: +k[2],
      l: +k[3],
      c: +k[4],
      v: +k[5],
    }));
  }
  if (ex === "bybit") {
    const int = intervalFor("bybit", interval);
    const u = new URL("https://api.bybit.com/v5/market/kline");
    u.searchParams.set("category", "linear");
    u.searchParams.set("symbol", bnStyleSymbol);
    u.searchParams.set("interval", int);
    u.searchParams.set("limit", String(limit));
    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      result?: { list?: string[][] };
    };
    const list = j.result?.list ?? [];
    return list
      .map((k) => ({
        t: +k[0],
        o: +k[1],
        h: +k[2],
        l: +k[3],
        c: +k[4],
        v: k[5] !== undefined ? +k[5] : undefined,
      }))
      .sort((a, b) => a.t - b.t);
  }
  const inst = toOkxSwapInstId(bnStyleSymbol);
  const bar = intervalFor("okx", interval);
  const u = new URL("https://www.okx.com/api/v5/market/candles");
  u.searchParams.set("instId", inst);
  u.searchParams.set("bar", bar);
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) return [];
  const j = (await res.json()) as {
    data?: string[][];
  };
  const list = j.data ?? [];
  return list
    .map((k) => ({
      t: +k[0],
      o: +k[1],
      h: +k[2],
      l: +k[3],
      c: +k[4],
      v: k[5] !== undefined ? +k[5] : undefined,
    }))
    .sort((a, b) => a.t - b.t);
}

/** Внутренний ключ BTCUSDT для REST/WS (OKX: из BTC-USDT-SWAP) */
export function bnStyleFromTicker(t: TickerSnapshot): string {
  if (t.exchange === "okx") {
    return t.nativeSymbol.replace(/-USDT-SWAP$/i, "USDT");
  }
  return t.nativeSymbol;
}

export async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function enrichWithNatr(
  tickers: TickerSnapshot[],
  interval: string,
  period = 14,
  maxCompute = 64,
): Promise<TickerSnapshot[]> {
  const top = tickers
    .filter((t) => t.quoteVolume24h > 0)
    .slice(0, maxCompute);
  const natrs = await withConcurrency(top, 12, async (t) => {
    const sym = bnStyleFromTicker(t);
    const bars = await fetchKlines(t.exchange, sym, interval, 120);
    const n = natrPct(bars, period);
    return { id: t.id, n };
  });
  const map = new Map(natrs.map((x) => [x.id, x.n]));
  return tickers.map((t) => ({
    ...t,
    natrPct: map.get(t.id) ?? t.natrPct,
  }));
}
