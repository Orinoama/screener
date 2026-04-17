import type { ExchangeId, OhlcBar } from "@/lib/types";
import { chartNativeSymbol, intervalFor } from "@/lib/exchanges/rest";

export type KlineHandler = (bar: OhlcBar, isFinal: boolean) => void;

function binanceFuturesWsUrl(bnSymbol: string, interval: string) {
  const s = bnSymbol.toLowerCase();
  const iv = intervalFor("binance", interval);
  return `wss://fstream.binance.com/ws/${s}@kline_${iv}`;
}

export function subscribeKline(
  exchange: ExchangeId,
  bnStyleSymbol: string,
  interval: string,
  onMessage: KlineHandler,
): () => void {
  if (exchange === "binance") {
    const url = binanceFuturesWsUrl(bnStyleSymbol, interval);
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          k?: {
            t: number;
            o: string;
            h: string;
            l: string;
            c: string;
            v?: string;
            x: boolean;
          };
        };
        const k = msg.k;
        if (!k) return;
        onMessage(
          {
            t: k.t,
            o: +k.o,
            h: +k.h,
            l: +k.l,
            c: +k.c,
            v: k.v !== undefined ? +k.v : undefined,
          },
          Boolean(k.x),
        );
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }

  if (exchange === "bybit") {
    const ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
    const int = intervalFor("bybit", interval);
    const sym = bnStyleSymbol.toUpperCase();
    const topic = `kline.${int}.${sym}`;
    ws.onopen = () => {
      ws.send(JSON.stringify({ op: "subscribe", args: [topic] }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          topic?: string;
          data?: Array<{
            start: number;
            open: string;
            high: string;
            low: string;
            close: string;
            volume?: string;
            confirm: boolean;
          }>;
        };
        if (!msg.topic?.startsWith("kline.")) return;
        const row = msg.data?.[0];
        if (!row) return;
        onMessage(
          {
            t: row.start,
            o: +row.open,
            h: +row.high,
            l: +row.low,
            c: +row.close,
            v: row.volume !== undefined ? +row.volume : undefined,
          },
          Boolean(row.confirm),
        );
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }

  const inst = chartNativeSymbol("okx", bnStyleSymbol);
  const bar = intervalFor("okx", interval);
  const channel = `candle${bar}`;
  const ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        op: "subscribe",
        args: [{ channel, instId: inst }],
      }),
    );
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as {
        arg?: { channel?: string };
        data?: Array<{
          ts: string;
          o: string;
          h: string;
          l: string;
          c: string;
          vol?: string;
          confirm: string;
        }>;
      };
      if (!msg.data?.[0]) return;
      const row = msg.data[0];
      onMessage(
        {
          t: +row.ts,
          o: +row.o,
          h: +row.h,
          l: +row.l,
          c: +row.c,
          v: row.vol !== undefined ? +row.vol : undefined,
        },
        row.confirm === "1",
      );
    } catch {
      /* ignore */
    }
  };
  return () => ws.close();
}
