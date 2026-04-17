import type { NextRequest } from "next/server";
import {
  enrichWithNatr,
  fetchBinanceUsdm24h,
  fetchBybitLinear24h,
  fetchOkxSwap24h,
} from "@/lib/exchanges/rest";
import type { SortKey, TickerSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

const SORTS = new Set<SortKey>(["natr", "range", "change", "volume"]);

function sortRows(sort: SortKey, rows: TickerSnapshot[]): TickerSnapshot[] {
  const copy = [...rows];
  switch (sort) {
    case "volume":
      return copy.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
    case "change":
      return copy.sort(
        (a, b) => Math.abs(b.changePct24h) - Math.abs(a.changePct24h),
      );
    case "range":
      return copy.sort((a, b) => b.rangePct24h - a.rangePct24h);
    case "natr":
      return copy.sort(
        (a, b) => (b.natrPct ?? -1) - (a.natrPct ?? -1),
      );
    default:
      return copy;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sort = (SORTS.has(sp.get("sort") as SortKey)
    ? sp.get("sort")
    : "volume") as SortKey;
  const _chartInterval = sp.get("interval") ?? "5m";
  const ex = sp.get("exchanges") ?? "binance,bybit,okx";
  const want = new Set(
    ex
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const settled = await Promise.allSettled([
    want.has("binance") ? fetchBinanceUsdm24h() : Promise.resolve([]),
    want.has("bybit") ? fetchBybitLinear24h() : Promise.resolve([]),
    want.has("okx") ? fetchOkxSwap24h() : Promise.resolve([]),
  ]);

  let merged: TickerSnapshot[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") merged = merged.concat(s.value);
  }

  merged.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

  let rows = await enrichWithNatr(merged, "5m", 14, 90);
  rows = sortRows(sort, rows);

  return Response.json({
    updatedAt: Date.now(),
    sort,
    interval: _chartInterval,
    natrSpec: "5m/14",
    rows: rows.slice(0, 500),
  });
}
