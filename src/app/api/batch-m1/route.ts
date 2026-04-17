import type { ExchangeId } from "@/lib/types";
import { fetchKlines, withConcurrency } from "@/lib/exchanges/rest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EX = new Set<ExchangeId>(["binance", "bybit", "okx"]);

type Item = { id: string; exchange: ExchangeId; symbol: string };

/** Последняя полностью закрытая 1m свеча: предпоследняя в ответе (последняя часто ещё формируется). */
function lastClosed1m(bars: { t: number; o: number; c: number }[]) {
  if (bars.length < 2) return null;
  const b = bars[bars.length - 2]!;
  return { t: b.t, o: b.o, c: b.c };
}

export async function POST(req: Request) {
  let body: { items?: Item[] };
  try {
    body = (await req.json()) as { items?: Item[] };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const raw = body.items ?? [];
  const items = raw
    .filter(
      (x) =>
        x &&
        typeof x.id === "string" &&
        EX.has(x.exchange) &&
        typeof x.symbol === "string",
    )
    .slice(0, 55);

  const results = await withConcurrency(items, 10, async (it) => {
    const bars = await fetchKlines(it.exchange, it.symbol.toUpperCase(), "1m", 5);
    const row = lastClosed1m(bars);
    if (!row) return { id: it.id, error: "no_bar" as const };
    return {
      id: it.id,
      t: row.t,
      o: row.o,
      c: row.c,
    };
  });

  return Response.json({ results });
}
