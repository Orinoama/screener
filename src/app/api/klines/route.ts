import type { NextRequest } from "next/server";
import type { ExchangeId } from "@/lib/types";
import { fetchKlines } from "@/lib/exchanges/rest";

export const dynamic = "force-dynamic";

const EX = new Set<ExchangeId>(["binance", "bybit", "okx"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const exchange = sp.get("exchange") as ExchangeId;
  const symbol = sp.get("symbol") ?? "";
  const interval = sp.get("interval") ?? "5m";
  const limit = Math.min(300, Math.max(20, +(sp.get("limit") ?? "120")));

  if (!EX.has(exchange) || !symbol) {
    return Response.json({ error: "bad_params" }, { status: 400 });
  }

  const bars = await fetchKlines(exchange, symbol.toUpperCase(), interval, limit);
  return Response.json({ bars });
}
