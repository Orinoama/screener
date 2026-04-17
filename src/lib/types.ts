export type ExchangeId = "binance" | "bybit" | "okx";

export type SortKey = "natr" | "range" | "change" | "volume";

export type ChartInterval = "1m" | "3m" | "5m" | "15m" | "1h";

export interface OhlcBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Базовый объём за свечу (если известен) */
  v?: number;
}

export interface UnifiedInstrument {
  id: string;
  exchange: ExchangeId;
  market: "futures";
  nativeSymbol: string;
  label: string;
}

export interface TickerSnapshot extends UnifiedInstrument {
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  baseVolume24h: number;
  changePct24h: number;
  /** (high-low)/open * 100 using 24h OHLC */
  rangePct24h: number;
  trades24h: number;
  natrPct?: number;
}

export type SoundType = "none" | "beep" | "ding" | "alert" | "rise" | "drop" | "chord";

export interface ImpulseSettings {
  enabled: boolean;
  pushEnabled: boolean;
  minMovePct: number;
  /** Only symbols with 24h quote volume above this (USDT) participate */
  minQuoteVolume24h: number;
  /** Minimum absolute 24h volume delta between refreshes as activity proxy (USDT) */
  minVolumeDelta24h: number;
  cooldownSec: number;
  soundType: SoundType;
  soundVolume: number;
}

export const DEFAULT_IMPULSE: ImpulseSettings = {
  enabled: false,
  pushEnabled: false,
  minMovePct: 3,
  minQuoteVolume24h: 5_000_000,
  minVolumeDelta24h: 0,
  cooldownSec: 0,
  soundType: "beep",
  soundVolume: 0.15,
};
