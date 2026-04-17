"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartInterval, ImpulseSettings, SortKey, SoundType, TickerSnapshot } from "@/lib/types";
import { DEFAULT_IMPULSE } from "@/lib/types";
import ChartCell from "@/components/ChartCell";
import { bnStyleFromTicker } from "@/lib/exchanges/rest";
import { fmtNatrTable, fmtVolTable, formatMinutesAgo } from "@/lib/format";

const LS_KEY = "crypto-screener-settings-v1";
const LS_BLACKLIST_KEY = "crypto-screener-blacklist-v1";

type ExchangeToggle = { binance: boolean; bybit: boolean; okx: boolean };

type ImpulseLogEntry = {
  id: string;
  label: string;
  pct: number;
  at: number;
};

type SidebarMode = "coins" | "notifications" | null;

type BlacklistEntry = {
  id: string;
  label: string;
};

function loadImpulse(): ImpulseSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_IMPULSE;
    const j = JSON.parse(raw) as Partial<ImpulseSettings>;
    return { ...DEFAULT_IMPULSE, ...j };
  } catch {
    return DEFAULT_IMPULSE;
  }
}

function saveImpulse(s: ImpulseSettings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function loadBlacklist(): BlacklistEntry[] {
  try {
    const raw = localStorage.getItem(LS_BLACKLIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BlacklistEntry[];
  } catch {
    return [];
  }
}

function saveBlacklist(list: BlacklistEntry[]) {
  try {
    localStorage.setItem(LS_BLACKLIST_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export default function ScreenerApp() {

const SOUNDS: { id: SoundType; name: string; play: (ctx: AudioContext, volume: number) => void }[] = [
  { id: "none", name: "Без звука", play: () => {} },
  {
    id: "beep",
    name: "Бип",
    play: (ctx, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = vol;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.2);
    },
  },
  {
    id: "ding",
    name: "Динь",
    play: (ctx, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 1200;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.3);
    },
  },
  {
    id: "alert",
    name: "Тревога",
    play: (ctx, vol) => {
      const beep = (freq: number, start: number, dur: number) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "square";
        o.frequency.value = freq;
        g.gain.value = vol * 0.5;
        o.connect(g);
        g.connect(ctx.destination);
        o.start(start);
        o.stop(start + dur);
      };
      beep(800, ctx.currentTime, 0.1);
      beep(600, ctx.currentTime + 0.15, 0.1);
      beep(800, ctx.currentTime + 0.3, 0.1);
    },
  },
  {
    id: "rise",
    name: "Рост",
    play: (ctx, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(400, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.2);
    },
  },
  {
    id: "drop",
    name: "Падение",
    play: (ctx, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(800, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.15);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.2);
    },
  },
  {
    id: "chord",
    name: "Аккорд",
    play: (ctx, vol) => {
      const note = (freq: number) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol * 0.4, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.4);
      };
      note(523);
      note(659);
      note(784);
    },
  },
];


  const [rows, setRows] = useState<TickerSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("natr");
  const [interval, setInterval] = useState<ChartInterval>("5m");
  const [gridN, setGridN] = useState(9);
  const [minVolM, setMinVolM] = useState(50);
  const minVolFilter = minVolM * 1_000_000;
  const [ex, setEx] = useState<ExchangeToggle>({
    binance: true,
    bybit: false,
    okx: false,
  });
  const [impulse, setImpulse] = useState<ImpulseSettings>(DEFAULT_IMPULSE);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("coins");
  const [impulseLog, setImpulseLog] = useState<ImpulseLogEntry[]>([]);
  const [, setLogTick] = useState(0);
  const [selectedTicker, setSelectedTicker] = useState<TickerSnapshot | null>(null);
  const [singleChartInterval, setSingleChartInterval] = useState<ChartInterval>("5m");
  const [chartPage, setChartPage] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  const prevM1BarT = useRef<Map<string, number>>(new Map());
  const rowsRef = useRef<TickerSnapshot[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const lastNotify = useRef<Map<string, number>>(new Map());
  const audioCtx = useRef<AudioContext | null>(null);

  const playSound = useCallback((soundType: SoundType, volume: number) => {
    if (soundType === "none") return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx.current) audioCtx.current = new Ctx();
      const ctx = audioCtx.current;
      if (ctx.state === "suspended") void ctx.resume();
      const sound = SOUNDS.find((s) => s.id === soundType);
      if (sound) sound.play(ctx, volume);
    } catch {
      /* ignore */
    }
  }, []);

  const previewSound = useCallback((soundType: SoundType) => {
    playSound(soundType, impulse.soundVolume);
  }, [playSound, impulse.soundVolume]);

  useEffect(() => {
    setImpulse(loadImpulse());
    setBlacklist(loadBlacklist());
  }, []);

  useEffect(() => {
    saveImpulse(impulse);
  }, [impulse]);

  useEffect(() => {
    saveBlacklist(blacklist);
  }, [blacklist]);

  useEffect(() => {
    if (sidebarMode !== "notifications") return;
    const id = window.setInterval(() => setLogTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [sidebarMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
        } else if (selectedTicker) {
          setSelectedTicker(null);
        }
        return;
      }
      if (e.key === "/" || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
          return;
        }
        e.preventDefault();
        setSearchOpen(true);
        const char = e.key === "/" ? "" : e.key.toUpperCase();
        setSearchQuery(char);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, selectedTicker]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const exchangesParam = useMemo(() => {
    const p: string[] = [];
    if (ex.binance) p.push("binance");
    if (ex.bybit) p.push("bybit");
    if (ex.okx) p.push("okx");
    return p.join(",");
  }, [ex]);

  const refreshMarket = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = new URL("/api/market", window.location.origin);
      u.searchParams.set("sort", sort);
      u.searchParams.set("interval", interval);
      u.searchParams.set("exchanges", exchangesParam || "binance");
      const res = await fetch(u.toString());
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { rows?: TickerSnapshot[] };
      setRows(j.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [sort, interval, exchangesParam]);

  useEffect(() => {
    void refreshMarket();
    const id = window.setInterval(() => {
      void refreshMarket();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [refreshMarket]);

  useEffect(() => {
    setSelectedTicker((prev) => {
      if (!prev) return prev;
      const fresh = rows.find((r) => r.id === prev.id);
      return fresh ?? prev;
    });
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => {
      if (r.quoteVolume24h < minVolFilter) return false;
      if (blacklist.some((b) => b.id === r.id)) return false;
      return true;
    }),
    [rows, minVolFilter, blacklist],
  );

  const filteredRef = useRef<TickerSnapshot[]>([]);
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);
  const impulseRef = useRef(impulse);
  useEffect(() => { impulseRef.current = impulse; }, [impulse]);
  const pushPermRef = useRef(pushPermission);
  useEffect(() => { pushPermRef.current = pushPermission; }, [pushPermission]);

  const addToBlacklist = (r: TickerSnapshot) => {
    setBlacklist((list) => {
      if (list.some((b) => b.id === r.id)) return list;
      return [...list, { id: r.id, label: r.label }];
    });
  };

  const removeFromBlacklist = (id: string) => {
    setBlacklist((list) => list.filter((b) => b.id !== id));
  };

  const totalPages = Math.ceil(filtered.length / gridN);
  
  const displayGrid = useMemo(() => {
    const start = chartPage * gridN;
    return filtered.slice(start, start + gridN);
  }, [filtered, chartPage, gridN]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return filtered.filter((r) => r.label.toLowerCase().includes(q)).slice(0, 20);
  }, [filtered, searchQuery]);

  const scanM1Impulses = useCallback(async () => {
    const imp = impulseRef.current;
    const slice = filteredRef.current
      .slice(0, 50)
      .filter((r) => r.quoteVolume24h >= imp.minQuoteVolume24h);
    if (slice.length === 0) return;
    const items = slice.map((r) => ({
      id: r.id,
      exchange: r.exchange,
      symbol: bnStyleFromTicker(r),
    }));
    let res: Response;
    try {
      res = await fetch("/api/batch-m1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
    } catch {
      return;
    }
    if (!res.ok) return;
    const j = (await res.json()) as {
      results?: Array<{ id: string; t?: number; o?: number; c?: number; error?: string }>;
    };
    const results = j.results ?? [];
    const now = Date.now();
    for (const row of results) {
      if (row.error || row.t == null || row.o == null || row.c == null || row.o === 0) continue;
      const meta = slice.find((s) => s.id === row.id);
      if (!meta) continue;
      const had = prevM1BarT.current.get(row.id);
      prevM1BarT.current.set(row.id, row.t);
      if (had === undefined) continue;
      if (row.t <= had) continue;
      const signedPct = ((row.c - row.o) / row.o) * 100;
      const pctMove = Math.abs(signedPct);
      if (pctMove < imp.minMovePct) continue;
      const lastT = lastNotify.current.get(row.id) ?? 0;
      if (now - lastT < imp.cooldownSec * 1000) continue;
      lastNotify.current.set(row.id, now);
      const title = `Импульс ${meta.label}`;
      const body = `1m: ${signedPct >= 0 ? "+" : ""}${signedPct.toFixed(2)}% · Vol ${fmtVolTable(meta.quoteVolume24h)}`;
      if (imp.pushEnabled && pushPermRef.current === "granted") {
        try {
          const n = new Notification(title, { body, silent: imp.soundType === "none", tag: meta.id });
          n.onclick = () => {
            window.focus();
            const t = rowsRef.current.find((r) => r.id === meta.id);
            if (t) openSingleChartRef.current(t);
            n.close();
          };
        } catch {
          /* ignore */
        }
      }
      setImpulseLog((log) =>
        [{ id: meta.id, label: meta.label, pct: signedPct, at: now }, ...log].slice(0, 120),
      );
      playSound(imp.soundType, imp.soundVolume);
    }
  }, [playSound]);

  useEffect(() => {
    if (!impulse.enabled) return;
    void scanM1Impulses();
    const id = window.setInterval(() => void scanM1Impulses(), 30_000);
    return () => window.clearInterval(id);
  }, [impulse.enabled, scanM1Impulses]);

  const toggleEx = (k: keyof ExchangeToggle) => {
    setEx((e) => ({ ...e, [k]: !e[k] }));
  };

  const openSingleChart = (r: TickerSnapshot) => {
    setSelectedTicker(r);
    setSingleChartInterval(interval);
    setSearchOpen(false);
    setSearchQuery("");
  };
  const openSingleChartRef = useRef(openSingleChart);
  useEffect(() => { openSingleChartRef.current = openSingleChart; });

  const closeSingleChart = () => {
    setSelectedTicker(null);
  };

  const toggleSidebar = (mode: SidebarMode) => {
    if (sidebarMode === mode) {
      setSidebarMode(null);
    } else {
      setSidebarMode(mode);
    }
  };

  const onRowClick = (r: TickerSnapshot) => {
    openSingleChart(r);
  };

  const onImpulseLogClick = (entry: ImpulseLogEntry) => {
    const ticker = rows.find((r) => r.id === entry.id);
    if (ticker) {
      openSingleChart(ticker);
    }
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#0b0e11] text-zinc-200">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800/80 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-zinc-500">Фьючерсы:</span>
          {(["binance", "bybit", "okx"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleEx(k)}
              className={`rounded px-2 py-0.5 font-medium capitalize ${
                ex[k]
                  ? "bg-emerald-600/25 text-emerald-300"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="mx-2 hidden h-5 w-px bg-zinc-800 sm:block" />

        {!selectedTicker && (
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">ТФ</span>
            {(["1m", "3m", "5m", "15m", "1h"] as ChartInterval[]).map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                className={`rounded px-2 py-0.5 ${
                  interval === iv
                    ? "bg-violet-600/40 text-violet-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {iv.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {!selectedTicker && (
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Сетка</span>
            {[6, 9, 12].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setGridN(n);
                  setChartPage(0);
                }}
                className={`rounded px-2 py-0.5 ${
                  gridN === n ? "bg-sky-700/40 text-sky-100" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        <div className="flex min-w-[140px] max-w-[220px] flex-1 flex-col gap-1">
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span>Фильтр 24ч</span>
            <span className="tabular-nums text-zinc-400">{minVolM}M USDT</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            step={1}
            value={minVolM}
            onChange={(e) => {
              setMinVolM(+e.target.value);
              setChartPage(0);
            }}
            className="volume-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(139,92,246,0.6)] [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:bg-violet-400 [&::-webkit-slider-thumb]:hover:shadow-[0_0_12px_rgba(139,92,246,0.8)] [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:shadow-[0_0_8px_rgba(139,92,246,0.6)]"
          />
        </div>

        <button
          type="button"
          onClick={() => void refreshMarket()}
          className="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700"
          title="Обновить"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className={`rounded px-2 py-0.5 ${impulse.enabled ? "bg-violet-700/50 text-violet-200" : "bg-zinc-800"}`}
          >
            Импульсы {impulse.enabled ? "вкл" : "выкл"}
          </button>
          <button
            type="button"
            title="Чёрный список"
            onClick={() => setShowBlacklist((s) => !s)}
            className={`relative flex items-center gap-1 rounded px-2 py-0.5 ${showBlacklist ? "bg-red-900/50 text-red-300" : "bg-zinc-800 text-zinc-400"}`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-5h2v2h-2zm0-8h2v6h-2z"/>
            </svg>
            {blacklist.length > 0 && (
              <span className="text-[10px]">({blacklist.length})</span>
            )}
          </button>
        </div>
      </header>

      {showBlacklist && (
        <div className="border-b border-zinc-800/80 bg-zinc-900/50 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-300">Чёрный список:</span>
            {blacklist.length === 0 ? (
              <span className="text-zinc-500">пусто</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {blacklist.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-1 rounded bg-red-950/40 px-2 py-0.5 text-red-200"
                  >
                    <span>{b.label}</span>
                    <button
                      type="button"
                      onClick={() => removeFromBlacklist(b.id)}
                      className="text-red-400 hover:text-red-200"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setBlacklist([])}
                  className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-400 hover:bg-zinc-700"
                >
                  Очистить всё
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowSettings(false)}>
          <div
            className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Настройки импульсов</h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={impulse.enabled}
                  onChange={(e) =>
                    setImpulse((p) => ({ ...p, enabled: e.target.checked }))
                  }
                  className="h-4 w-4"
                />
                <span className="text-zinc-200">Включить отслеживание импульсов (опрос ~30 с)</span>
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-400">Мин. движение за 1m (%)</span>
                  <input
                    type="number"
                    step={0.05}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
                    value={impulse.minMovePct}
                    onChange={(e) =>
                      setImpulse((p) => ({
                        ...p,
                        minMovePct: +e.target.value || 0,
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-400">Пауза между сигналами (сек)</span>
                  <input
                    type="number"
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
                    value={impulse.cooldownSec}
                    onChange={(e) =>
                      setImpulse((p) => ({
                        ...p,
                        cooldownSec: +e.target.value || 0,
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-400">Мин. объём 24ч (M USDT)</span>
                  <input
                    type="number"
                    step={1}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
                    value={impulse.minQuoteVolume24h / 1_000_000}
                    onChange={(e) =>
                      setImpulse((p) => ({
                        ...p,
                        minQuoteVolume24h: (+e.target.value || 0) * 1_000_000,
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-400">Δ объёма 24ч M (0 = выкл)</span>
                  <input
                    type="number"
                    step={0.1}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
                    value={impulse.minVolumeDelta24h / 1_000_000}
                    onChange={(e) =>
                      setImpulse((p) => ({
                        ...p,
                        minVolumeDelta24h: (+e.target.value || 0) * 1_000_000,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <div className="mb-2 text-xs font-medium text-zinc-400">Звук уведомления</div>
                <div className="grid grid-cols-4 gap-2">
                  {SOUNDS.filter((s) => s.id !== "none").map((sound) => (
                    <button
                      key={sound.id}
                      type="button"
                      onClick={() => {
                        setImpulse((p) => ({ ...p, soundType: sound.id }));
                        previewSound(sound.id);
                      }}
                      className={`rounded px-3 py-2 text-xs transition-all ${
                        impulse.soundType === sound.id
                          ? "bg-violet-600 text-white"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {sound.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setImpulse((p) => ({ ...p, soundType: "none" }));
                  }}
                  className={`mt-2 rounded px-3 py-2 text-xs transition-all ${
                    impulse.soundType === "none"
                      ? "bg-zinc-600 text-white"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  Без звука
                </button>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <label className="flex flex-col gap-2">
                  <span className="text-xs text-zinc-400">Громкость: {Math.round(impulse.soundVolume * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={impulse.soundVolume}
                    onChange={(e) => {
                      const vol = +e.target.value;
                      setImpulse((p) => ({ ...p, soundVolume: vol }));
                      if (impulse.soundType !== "none") {
                        previewSound(impulse.soundType);
                      }
                    }}
                    className="volume-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(139,92,246,0.6)]"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`rounded px-3 py-1.5 text-sm ${
                      impulse.pushEnabled
                        ? "bg-violet-700/60 text-violet-200 hover:bg-violet-700"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                    onClick={async () => {
                      if (!impulse.pushEnabled) {
                        if (pushPermission !== "granted") {
                          const p = await Notification.requestPermission();
                          setPushPermission(p);
                          if (p !== "granted") return;
                        }
                        setImpulse((p) => ({ ...p, pushEnabled: true }));
                      } else {
                        setImpulse((p) => ({ ...p, pushEnabled: false }));
                      }
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                      </svg>
                      {impulse.pushEnabled ? "Push вкл" : "Push выкл"}
                    </span>
                  </button>
                  {pushPermission === "denied" && (
                    <span className="text-[10px] text-red-400">Заблокировано браузером</span>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded bg-zinc-700 px-4 py-1.5 text-sm hover:bg-zinc-600"
                  onClick={() => setShowSettings(false)}
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {err && (
        <div className="bg-red-950/40 px-3 py-1 text-xs text-red-300">{err}</div>
      )}

      {searchOpen && (
        <div className="relative border-b border-zinc-800/80 bg-zinc-900/80 px-3 py-2">
          <div className="relative w-full max-w-md">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
              placeholder="Поиск монеты... (Esc — закрыть)"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setSearchQuery("");
                }
                if (e.key === "Enter" && searchResults.length > 0) {
                  openSingleChart(searchResults[0]);
                }
              }}
            />
            {searchQuery.trim() && (
              <div className="absolute top-full left-0 z-50 mt-1 max-h-80 w-full overflow-auto rounded border border-zinc-700 bg-zinc-950 shadow-lg">
                {searchResults.length > 0 ? (
                  searchResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openSingleChart(r)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-800"
                    >
                      <span className="font-medium text-zinc-200">{r.label}</span>
                      <span className={r.changePct24h >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {r.changePct24h.toFixed(2)}%
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm text-zinc-500">Ничего не найдено</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {selectedTicker ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col p-2">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={closeSingleChart}
                className="flex items-center gap-1 rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
              >
                ← Назад к сетке
              </button>
              <span className="text-zinc-400">|</span>
              <span className="font-semibold text-zinc-200">{selectedTicker.label}</span>
              <span
                className={`rounded px-2 py-0.5 tabular-nums ${
                  selectedTicker.changePct24h >= 0
                    ? "bg-emerald-950/40 text-emerald-300"
                    : "bg-red-950/40 text-red-300"
                }`}
              >
                {selectedTicker.changePct24h >= 0 ? "+" : ""}
                {selectedTicker.changePct24h.toFixed(2)}%
              </span>
              <span className="text-zinc-400">|</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500 text-xs">ТФ:</span>
                {(["1m", "3m", "5m", "15m", "1h"] as ChartInterval[]).map((iv) => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => setSingleChartInterval(iv)}
                    className={`rounded px-2 py-0.5 text-xs ${
                      singleChartInterval === iv
                        ? "bg-violet-600/40 text-violet-100"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {iv.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  addToBlacklist(selectedTicker);
                  closeSingleChart();
                }}
                className="flex items-center gap-1 rounded bg-red-900/40 px-2 py-1 text-xs text-red-300 hover:bg-red-900/60"
              >
                <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
                </svg>
                Скрыть
              </button>
              <span className="ml-auto text-xs text-zinc-500">Esc — вернуться</span>
            </div>
            <div className="min-h-0 flex-1">
              <ChartCell ticker={selectedTicker} interval={singleChartInterval} fullSize />
            </div>
          </main>
        ) : (
          <main
            className="grid min-h-0 min-w-0 flex-1 gap-1 p-1"
            style={{
              gridTemplateColumns: `repeat(${gridN === 12 ? 4 : 3}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${Math.ceil(gridN / (gridN === 12 ? 4 : 3))}, minmax(0, 1fr))`,
            }}
          >
            {displayGrid.map((t) => (
              <ChartCell key={t.id} ticker={t} interval={interval} />
            ))}
          </main>
        )}

        {sidebarMode === "coins" ? (
          <aside className="flex w-[min(100%,380px)] shrink-0 flex-col border-l border-zinc-800/80 bg-[#0b0e11] text-[11px] sm:w-96">
            <div className="flex items-center border-b border-zinc-800/80 px-2 py-1">
              <span className="font-semibold text-zinc-300">Монеты · USDT perpetual</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-[#0b0e11] text-zinc-500">
                  <tr>
                    <th className="px-1 py-1">Тикер</th>
                    <th
                      className="cursor-pointer px-1 py-1 hover:text-zinc-300"
                      onClick={() => setSort("change")}
                    >
                      <span className="flex items-center gap-1">
                        24ч %
                        {sort === "change" && (
                          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current text-violet-400">
                            <path d="M7 10l5 5 5-5z"/>
                          </svg>
                        )}
                      </span>
                    </th>
                    <th
                      className="cursor-pointer px-1 py-1 hover:text-zinc-300"
                      onClick={() => setSort("natr")}
                    >
                      <span className="flex items-center gap-1">
                        NATR
                        {sort === "natr" && (
                          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current text-violet-400">
                            <path d="M7 10l5 5 5-5z"/>
                          </svg>
                        )}
                      </span>
                    </th>
                    <th
                      className="cursor-pointer px-1 py-1 hover:text-zinc-300"
                      onClick={() => setSort("range")}
                    >
                      <span className="flex items-center gap-1">
                        R24
                        {sort === "range" && (
                          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current text-violet-400">
                            <path d="M7 10l5 5 5-5z"/>
                          </svg>
                        )}
                      </span>
                    </th>
                    <th
                      className="cursor-pointer px-1 py-1 hover:text-zinc-300"
                      onClick={() => setSort("volume")}
                    >
                      <span className="flex items-center gap-1">
                        Vol
                        {sort === "volume" && (
                          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current text-violet-400">
                            <path d="M7 10l5 5 5-5z"/>
                          </svg>
                        )}
                      </span>
                    </th>
                    <th className="px-0.5 py-1 w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 120).map((r) => (
                    <tr
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onRowClick(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(r);
                        }
                      }}
                      className="cursor-pointer border-t border-zinc-900 hover:bg-zinc-900/60"
                    >
                      <td className="px-1 py-0.5 font-medium text-zinc-200">{r.label}</td>
                      <td
                        className={
                          r.changePct24h >= 0 ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {r.changePct24h.toFixed(2)}%
                      </td>
                      <td className="tabular-nums text-zinc-400">{fmtNatrTable(r.natrPct)}</td>
                      <td className="tabular-nums text-zinc-400">
                        {r.rangePct24h.toFixed(2)}%
                      </td>
                      <td className="tabular-nums text-zinc-500">
                        {fmtVolTable(r.quoteVolume24h)}
                      </td>
                      <td className="px-0.5 py-0.5">
                        <button
                          type="button"
                          title="Добавить в чёрный список"
                          onClick={(e) => {
                            e.stopPropagation();
                            addToBlacklist(r);
                          }}
                          className="flex h-4 w-4 items-center justify-center rounded text-zinc-600 hover:bg-red-900/40 hover:text-red-400"
                        >
                          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-zinc-800/80 px-2 py-1 text-zinc-500">
              {loading ? "Загрузка…" : `Обновлено · ${filtered.length} пар · клик — график + копия`}
            </div>
          </aside>
        ) : null}

        {sidebarMode === "notifications" ? (
          <aside className="flex w-[min(100%,300px)] shrink-0 flex-col border-l border-zinc-800/80 bg-[#0b0e11] text-[11px] sm:w-72">
            <div className="border-b border-zinc-800/80 px-2 py-1 font-semibold text-zinc-300">
              Импульсы (1m)
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {impulseLog.length === 0 ? (
                <div className="p-2 text-zinc-500">Пока нет записей</div>
              ) : (
                <ul className="divide-y divide-zinc-900">
                  {impulseLog.map((e) => {
                    const ticker = rows.find((r) => r.id === e.id);
                    return (
                      <li
                        key={`${e.id}-${e.at}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => ticker && onImpulseLogClick(e)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            if (ticker) onImpulseLogClick(e);
                          }
                        }}
                        className="cursor-pointer px-2 py-1.5 hover:bg-zinc-800/50"
                      >
                        <div className="font-medium text-zinc-200">{e.label}</div>
                        <div className="flex justify-between gap-2 text-zinc-400">
                          <span className="text-amber-400/90">
                            {e.pct >= 0 ? "+" : ""}
                            {e.pct.toFixed(2)}%
                          </span>
                          <span className="shrink-0 text-zinc-500">
                            {formatMinutesAgo(e.at)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        ) : null}

        <aside className="flex w-9 shrink-0 flex-col items-center gap-2 border-l border-zinc-800/80 bg-zinc-950/90 py-2">
          <button
            type="button"
            title="Список монет"
            onClick={() => toggleSidebar("coins")}
            className={`flex h-8 w-7 items-center justify-center rounded text-sm leading-none hover:bg-zinc-800 ${
              sidebarMode === "coins" ? "text-violet-300" : "text-zinc-500"
            }`}
          >
            ≡
          </button>
          <button
            type="button"
            title="История импульсов"
            onClick={() => toggleSidebar("notifications")}
            className={`relative flex h-8 w-7 items-center justify-center rounded text-sm leading-none hover:bg-zinc-800 ${
              sidebarMode === "notifications" ? "text-amber-300" : "text-zinc-500"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M12 2C8.13 2 5 5.13 5 9v5l-1 1v1h16v-1l-1-1V9c0-3.87-3.13-7-7-7zm0 2c2.76 0 5 2.24 5 5v5H7V9c0-2.76 2.24-5 5-5zm-2 15c0 1.1.9 2 2 2s2-.9 2-2h-4z"/>
            </svg>
            {impulseLog.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-zinc-900">
                {impulseLog.length > 99 ? "99+" : impulseLog.length}
              </span>
            )}
          </button>
          <div className="my-1 w-5 border-t border-zinc-800" />
          {!selectedTicker && totalPages > 1 && (
            <>
              <div className="mt-2 flex flex-col items-center gap-1 text-[10px] text-zinc-500">
                <span>{chartPage + 1}/{totalPages}</span>
              </div>
              <button
                type="button"
                onClick={() => setChartPage((p) => Math.max(0, p - 1))}
                disabled={chartPage === 0}
                className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => setChartPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={chartPage >= totalPages - 1}
                className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
              >
                ↓
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
