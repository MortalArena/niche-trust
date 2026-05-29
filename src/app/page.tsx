'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Market {
  id: string;
  question: string;
  yes_price: number;
  no_price: number;
  volume_24h: number;
  liquidity: number;
  txns: number;
  mcap: number;
  price_change_5m: number;
  price_change_1h: number;
  price_change_6h: number;
  price_change_24h: number;
  age_hours: number;
  traders: number;
  category: string;
  image_url: string | null;
  platform: string;
  url: string;
  // Computed client-side velocity
  velocity?: number;
}

interface Trade {
  id: string;
  wallet: string;
  side: string;
  outcome: string;
  price: number;
  size: number;
  total_value: number;
  timestamp: number;
  time_ago: string;
}

interface MarketsResponse {
  markets: Market[];
  total: number;
  page: number;
  pageSize: number;
  total_pages: number;
  categories: Record<string, number>;
  platforms: Record<string, number>;
}

const CATS = [
  { slug: 'all', label: 'All' },
  { slug: 'politics', label: 'Politics' },
  { slug: 'crypto', label: 'Crypto' },
  { slug: 'science', label: 'Tech' },
  { slug: 'economics', label: 'Macro' },
  { slug: 'culture', label: 'Pop Culture' },
  { slug: 'sports', label: 'Sports' },
];

const SECTIONS = [
  { label: 'Live Markets', href: '/', value: 'Dex terminal', accent: '#10b981' },
  { label: 'Trader Board', href: '/leaderboard', value: 'Edge ranks', accent: '#3b82f6' },
  { label: 'Private Groups', href: '/groups', value: 'E2EE signals', accent: '#8b5cf6' },
  { label: 'Bots Market', href: '/bots', value: 'Agents/tools', accent: '#f59e0b' },
];

const TREND_WINDOWS = [
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
];

function fmtN(n: number): string {
  if (!n || n <= 0) return '-';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function clsC(n: number): string {
  if (n > 0) return '#22c55e'; // Emerald-500 neon
  if (n < 0) return '#ef4444'; // Red-500 neon
  return '#94a3b8';
}

function fmtAge(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function initials(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) || 'PM';
}

export default function HomePage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [cat, setCat] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [platforms, setPlatforms] = useState<Record<string, number>>({});
  const [platformFilter, setPlatformFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [trendWindow, setTrendWindow] = useState(TREND_WINDOWS[0]);
  const [flashingRows, setFlashingRows] = useState<Record<string, 'up' | 'down'>>({});

  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch(`/api/markets/live?cat=${cat}&page=${page}&limit=200`);
      const j: MarketsResponse = await r.json();
      let ms = j.markets || [];
      if (platformFilter !== 'all') {
        ms = ms.filter((m) => m.platform === platformFilter);
      }

      // Calculate Probability Velocity: DP = P_current - P_1h
      // P_1h = P_current / (1 + price_change_1h / 100)
      ms = ms.map((m) => {
        const p1h = m.yes_price / (1 + (m.price_change_1h || 0) / 100);
        const velocity = m.yes_price - p1h;
        return { ...m, velocity };
      });

      setMarkets(ms);
      setTotalPages(j.total_pages || 1);
      setPlatforms(j.platforms || {});
    } catch {
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, [cat, page, platformFilter]);

  const fetchTrades = useCallback(async () => {
    try {
      const r = await fetch('/api/markets/trades');
      const j = await r.json();
      setTrades((j.trades || []).slice(0, 200));
    } catch {
      setTrades([]);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  useEffect(() => {
    fetchTrades();
    const i = setInterval(fetchTrades, 5000);
    return () => clearInterval(i);
  }, [fetchTrades]);

  // Live High-Frequency Price Tick Simulation
  useEffect(() => {
    if (markets.length === 0 || loading) return;

    const interval = setInterval(() => {
      // Pick 2-3 random markets to change prices slightly
      const countToChange = Math.floor(Math.random() * 2) + 2;
      const targetIndices = new Set<number>();
      while (targetIndices.size < Math.min(countToChange, markets.length)) {
        targetIndices.add(Math.floor(Math.random() * markets.length));
      }

      const flashMap: Record<string, 'up' | 'down'> = {};

      setMarkets((prevMarkets) =>
        prevMarkets.map((m, idx) => {
          if (targetIndices.has(idx)) {
            const isUp = Math.random() > 0.45;
            const delta = isUp ? 1 : -1;
            const newYes = Math.max(5, Math.min(95, m.yes_price + delta));
            const newNo = 100 - newYes;
            const velocityDelta = delta * 0.2;
            const priceChangeDelta = isUp ? 0.3 : -0.3;

            flashMap[m.id] = isUp ? 'up' : 'down';

            return {
              ...m,
              yes_price: newYes,
              no_price: newNo,
              price_change_1h: +(m.price_change_1h + priceChangeDelta).toFixed(2),
              velocity: (m.velocity || 0) + velocityDelta,
            };
          }
          return m;
        })
      );

      setFlashingRows(flashMap);
      setTimeout(() => {
        setFlashingRows({});
      }, 350);

    }, 2800);

    return () => clearInterval(interval);
  }, [markets.length, loading]);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const filteredTrades = trades
    .filter((t) => nowSeconds - t.timestamp <= trendWindow.seconds)
    .sort((a, b) => b.total_value - a.total_value);
  const trendingTrades = filteredTrades.length > 0 ? filteredTrades.slice(0, 15) : [...trades].sort((a, b) => b.total_value - a.total_value).slice(0, 15);
  const trendVolume = trendingTrades.reduce((sum, t) => sum + t.total_value, 0);
  const buyVolume = trendingTrades
    .filter((t) => t.side === 'BUY')
    .reduce((sum, t) => sum + t.total_value, 0);
  const sellVolume = Math.max(0, trendVolume - buyVolume);
  const buyShare = trendVolume ? (buyVolume / trendVolume) * 100 : 50;

  // Sorting markets by absolute velocity to find fastest movers
  const velocityMovers = [...markets]
    .filter((m) => Math.abs(m.velocity || 0) > 0.05)
    .sort((a, b) => Math.abs(b.velocity || 0) - Math.abs(a.velocity || 0))
    .slice(0, 5);

  const maxLiquidity = Math.max(...markets.map((m) => m.liquidity), 1);

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 selection:bg-blue-600/30 selection:text-white">
      {/* Dense Ticker Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-900 bg-[#030712]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1760px] items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-1.5 font-mono text-sm font-black tracking-tighter text-white">
              <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-blue-600 text-xs font-black text-white shadow-lg">N</span>
              <span>NICHE<span className="text-blue-500">TRUST</span></span>
              <span className="rounded bg-zinc-900 px-1 py-0.5 text-[8px] font-bold text-zinc-500">PRO</span>
            </Link>
            <nav className="hidden items-center gap-1.5 md:flex">
              {SECTIONS.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="rounded px-2.5 py-1 font-mono text-[10px] font-bold tracking-tight text-slate-400 hover:bg-zinc-900 hover:text-white transition-all"
                >
                  {s.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className="flex items-center gap-1 text-emerald-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              LIVE STREAM
            </span>
            <span className="text-zinc-700">|</span>
            <select
              value={platformFilter}
              onChange={(e) => {
                setPlatformFilter(e.target.value);
                setPage(1);
              }}
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-slate-300 outline-none hover:border-zinc-700 transition"
            >
              <option value="all">ALL PLATFORMS</option>
              {Object.keys(platforms).map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()} ({platforms[p]})
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                fetchMarkets();
                fetchTrades();
              }}
              className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5 font-bold text-slate-400 hover:bg-zinc-800 hover:text-white transition"
            >
              REFRESH
            </button>
          </div>
        </div>
      </header>

      {/* Probability Velocity Ticker Band */}
      {velocityMovers.length > 0 && (
        <div className="border-b border-zinc-900 bg-zinc-950 px-4 py-1.5">
          <div className="mx-auto flex max-w-[1760px] items-center gap-3 overflow-x-auto scrollbar-none font-mono text-[10px]">
            <span className="flex shrink-0 items-center gap-1 font-bold text-amber-500">
              ⚡ VELOCITY TRACKER:
            </span>
            <div className="flex items-center gap-6">
              {velocityMovers.map((m) => {
                const vel = m.velocity || 0;
                return (
                  <Link
                    key={`vel-${m.id}`}
                    href={`/market/${m.id}`}
                    className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition"
                  >
                    <span className="text-slate-400 truncate max-w-[140px]">{m.question}</span>
                    <span className="font-bold text-white">{m.yes_price}%</span>
                    <span
                      className="font-bold rounded-sm px-1 py-px text-[9px] shadow-[0_0_8px_currentColor]/10"
                      style={{
                        background: vel >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        color: vel >= 0 ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {vel >= 0 ? '↑' : '↓'} {Math.abs(vel).toFixed(1)}%
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1760px] px-4 py-4">
        {/* Statistics Band */}
        <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-zinc-900 bg-zinc-950 p-3 shadow-sm hover:border-zinc-800 transition">
            <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500">Active Scanner</div>
            <div className="mt-1 font-mono text-lg font-black text-white leading-tight">Polymarket, Kalshi & Manifold</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-500">Aggregated real-time predictions</div>
          </div>
          <div className="rounded border border-zinc-900 bg-zinc-950 p-3 shadow-sm hover:border-zinc-800 transition">
            <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500">Monitored Events</div>
            <div className="mt-1 font-mono text-xl font-black tabular-nums text-blue-500">{markets.length}</div>
            <div className="mt-0.5 font-mono text-[10px] text-zinc-500">Page {page} / {totalPages}</div>
          </div>
          <div className="rounded border border-zinc-900 bg-zinc-950 p-3 shadow-sm hover:border-zinc-800 transition">
            <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500">Flow Volume ({trendWindow.label})</div>
            <div className="mt-1 font-mono text-xl font-black tabular-nums text-white">{fmtN(trendVolume)}</div>
            <div className="mt-0.5 font-mono text-[10px] text-zinc-500">Calculated from recent txns</div>
          </div>
          <div className="rounded border border-zinc-900 bg-zinc-950 p-3 shadow-sm hover:border-zinc-800 transition">
            <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500">Buy / Sell Pressure</div>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded bg-red-950">
              <div className="bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" style={{ width: `${buyShare}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[9px] tabular-nums">
              <span className="font-bold text-emerald-500">BUYS {buyShare.toFixed(0)}%</span>
              <span className="font-bold text-red-500">SELLS {(100 - buyShare).toFixed(0)}%</span>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Main Table Column */}
          <div className="min-w-0 flex-1">
            {/* Category pills & navigation */}
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {CATS.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => {
                      setCat(c.slug);
                      setPage(1);
                    }}
                    className={`rounded px-3 py-1 font-mono text-[10px] font-bold uppercase transition-all tracking-tight ${
                      cat === c.slug
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/10'
                        : 'bg-zinc-950 border border-zinc-900 text-slate-400 hover:border-zinc-800 hover:text-white'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center border border-zinc-900 bg-zinc-950/40 rounded-lg py-36">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-6 w-6 animate-spin rounded-full border border-blue-500 border-t-transparent" />
                  <span className="font-mono text-[10px] text-zinc-500">TUNING RADAR FREQUENCIES...</span>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded border border-zinc-900 bg-zinc-950/60 backdrop-blur-md">
                  <table className="w-full text-left font-mono text-[10px]">
                    <thead>
                      <tr className="border-b border-zinc-950 bg-zinc-900/40 text-[9px] uppercase tracking-wider text-zinc-500">
                        <th className="px-2.5 py-3 font-semibold text-center" style={{ width: 40 }}>#</th>
                        <th className="px-3 py-3 font-semibold">Event Target Asset</th>
                        <th className="px-2 py-3 font-semibold text-right">Probability</th>
                        <th className="px-2 py-3 font-semibold text-right hidden sm:table-cell">1h Shift</th>
                        <th className="px-2 py-3 font-semibold text-right hidden md:table-cell">Velocity</th>
                        <th className="px-2 py-3 font-semibold text-right">24h Vol</th>
                        <th className="px-2 py-3 font-semibold hidden md:table-cell">Liquidity Depth</th>
                        <th className="px-2 py-3 font-semibold text-right hidden lg:table-cell">MCAP</th>
                        <th className="px-2 py-3 font-semibold text-right hidden lg:table-cell">Txns</th>
                        <th className="px-2 py-3 font-semibold text-right hidden xl:table-cell">Traders</th>
                        <th className="px-2 py-3 font-semibold text-center hidden xl:table-cell" style={{ width: 110 }}>Sentiment Depth</th>
                        <th className="px-2 py-3 text-center" style={{ width: 60 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {markets.map((m, idx) => {
                        const globalIdx = (page - 1) * 200 + idx + 1;
                        const yesW = Math.max(0, Math.min(100, m.yes_price));
                        const noW = Math.max(0, Math.min(100, m.no_price));
                        const vel = m.velocity || 0;
                        const flashState = flashingRows[m.id];
                        const liqPct = Math.max(2, Math.min(100, (m.liquidity / maxLiquidity) * 100));

                        let flashClass = '';
                        if (flashState === 'up') flashClass = 'bg-[#10b981]/15 text-[#10b981] duration-0';
                        else if (flashState === 'down') flashClass = 'bg-[#ef4444]/15 text-[#ef4444] duration-0';

                        return (
                          <tr
                            key={m.id}
                            className={`border-b border-zinc-900 transition-colors duration-500 hover:bg-zinc-900/30 ${flashClass}`}
                          >
                            <td className="px-2.5 py-2 text-center text-zinc-600 font-bold">{globalIdx}</td>
                            <td className="px-3 py-2">
                              <Link href={`/market/${m.id}`} className="flex items-center gap-2 group">
                                {m.image_url ? (
                                  <img src={m.image_url} alt="" className="h-5 w-5 rounded-full object-cover border border-zinc-800" />
                                ) : (
                                  <div className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 text-[8px] font-bold text-zinc-400 border border-zinc-700">
                                    {initials(m.question)}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-slate-100 group-hover:text-blue-400 font-bold tracking-tight transition-colors" title={m.question}>
                                    {m.question}
                                  </span>
                                  <div className="flex items-center gap-1.5 mt-0.5 text-[8px]">
                                    <span className="rounded bg-zinc-900 border border-zinc-800 px-1 py-px uppercase text-zinc-500">{m.category}</span>
                                    <span className="rounded bg-zinc-900 border border-zinc-800 px-1 py-px font-bold text-blue-500 capitalize">{m.platform}</span>
                                  </div>
                                </div>
                              </Link>
                            </td>
                             <td className="px-2 py-2 text-right font-black text-white text-[11px] tabular-nums">
                              {yesW}%
                            </td>
                            <td className="px-2 py-2 text-right font-bold tabular-nums hidden sm:table-cell" style={{ color: clsC(m.price_change_1h) }}>
                              {m.price_change_1h >= 0 ? '+' : ''}{m.price_change_1h.toFixed(1)}%
                            </td>
                            <td className="px-2 py-2 text-right font-bold tabular-nums hidden md:table-cell">
                              <span
                                className="rounded px-1 py-px text-[9px]"
                                style={{
                                  color: vel >= 0 ? '#10b981' : '#ef4444',
                                  background: vel >= 0 ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                                }}
                              >
                                {vel >= 0 ? '↑' : '↓'}{Math.abs(vel).toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right font-bold text-slate-200 tabular-nums">{fmtN(m.volume_24h)}</td>
                            <td className="px-2 py-2 vertical-align-middle hidden md:table-cell">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded bg-zinc-900">
                                  <div className="h-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.6)]" style={{ width: `${liqPct}%` }} />
                                </div>
                                <span className="text-[9px] text-zinc-400 font-bold">{fmtN(m.liquidity)}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right text-zinc-400 tabular-nums hidden lg:table-cell">{fmtN(m.mcap)}</td>
                            <td className="px-2 py-2 text-right text-zinc-400 tabular-nums hidden lg:table-cell">{m.txns.toLocaleString()}</td>
                            <td className="px-2 py-2 text-right text-zinc-400 tabular-nums hidden xl:table-cell">{m.traders.toLocaleString()}</td>
                            <td className="px-2 py-2 hidden xl:table-cell">
                              <div className="mx-auto flex h-1 overflow-hidden rounded bg-zinc-900" style={{ width: 80 }}>
                                <div className="h-full bg-emerald-500 shadow-[0_0_4px_#10b981]" style={{ width: `${yesW}%` }} />
                                <div className="h-full bg-red-500 shadow-[0_0_4px_#ef4444]" style={{ width: `${noW}%` }} />
                              </div>
                              <div className="mt-0.5 flex justify-between px-1 text-[8px] font-bold">
                                <span className="text-emerald-500">Y {yesW}</span>
                                <span className="text-red-500">N {noW}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <Link
                                href={`/market/${m.id}`}
                                className="inline-block rounded bg-blue-600 hover:bg-blue-500 text-white font-bold px-2 py-1 text-[9px] hover:shadow-lg hover:shadow-blue-500/20 tracking-tighter uppercase transition"
                              >
                                Trade
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                      {markets.length === 0 && (
                        <tr>
                          <td colSpan={12} className="py-24 text-center text-zinc-500 uppercase tracking-widest text-[9px]">
                            No live prediction assets available on this radar
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="mt-3 flex items-center justify-between border-t border-zinc-900 pt-3">
                  <span className="text-[9px] text-zinc-500 uppercase font-bold">
                    RADAR PAGE {page} OF {totalPages} · {markets.length} ACTIVE SCANNER ENTRIES
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="rounded border border-zinc-800 bg-zinc-950 px-3 py-1 font-bold text-slate-400 hover:bg-zinc-900 hover:text-white transition disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      PREV
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="rounded border border-zinc-800 bg-zinc-950 px-3 py-1 font-bold text-slate-400 hover:bg-zinc-900 hover:text-white transition disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      NEXT
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Sidebar Smart Flow */}
          <aside className="w-full shrink-0 space-y-3 lg:w-[340px]">
            {/* Live Flow Trends */}
            <div className="rounded border border-zinc-900 bg-zinc-950 p-3 shadow-md">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="font-mono text-[10px] font-black uppercase text-white tracking-tight">🔥 SMART FLOW STREAM</h3>
                <div className="flex rounded border border-zinc-800 bg-zinc-950 p-0.5 font-mono">
                  {TREND_WINDOWS.map((w) => (
                    <button
                      key={w.label}
                      type="button"
                      onClick={() => setTrendWindow(w)}
                      className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase transition ${
                        trendWindow.label === w.label ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-white'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3 grid grid-cols-3 gap-1 text-center font-mono">
                <div className="rounded border border-zinc-900 bg-[#090d11] p-1.5">
                  <div className="text-[8px] uppercase text-zinc-500 font-semibold">VOLUME</div>
                  <div className="mt-0.5 text-[11px] font-black text-white">{fmtN(trendVolume)}</div>
                </div>
                <div className="rounded border border-zinc-900 bg-[#090d11] p-1.5">
                  <div className="text-[8px] uppercase text-zinc-500 font-semibold">BUYS</div>
                  <div className="mt-0.5 text-[11px] font-black text-emerald-400">{fmtN(buyVolume)}</div>
                </div>
                <div className="rounded border border-zinc-900 bg-[#090d11] p-1.5">
                  <div className="text-[8px] uppercase text-zinc-500 font-semibold">SELLS</div>
                  <div className="mt-0.5 text-[11px] font-black text-red-400">{fmtN(sellVolume)}</div>
                </div>
              </div>

              <div className="space-y-1 overflow-y-auto max-h-[290px] pr-1.5 scrollbar-thin">
                {trendingTrades.map((t, i) => (
                  <div key={`${t.id}-${i}`} className="flex items-center gap-1.5 rounded border border-zinc-900 bg-[#090d11] px-2 py-1.5 font-mono text-[9px] hover:border-zinc-800 transition">
                    <span className="text-zinc-600 font-bold">#{i + 1}</span>
                    <span
                      className="rounded px-1 py-px text-[7px] font-black"
                      style={{
                        background: t.side === 'BUY' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                        color: t.side === 'BUY' ? '#10b981' : '#ef4444',
                      }}
                    >
                      {t.side}
                    </span>
                    <span className={`font-bold ${t.outcome === 'YES' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.outcome}
                    </span>
                    <span className="font-black text-white">{fmtN(t.total_value)}</span>
                    <span className="text-zinc-400">{(t.price * 100).toFixed(0)}¢</span>
                    <span className="ml-auto text-[8px] text-zinc-500 tabular-nums">{t.time_ago}</span>
                  </div>
                ))}
                {trendingTrades.length === 0 && (
                  <div className="py-8 text-center text-zinc-600 uppercase font-bold tracking-tight text-[9px]">
                    No smart trades recorded in this window
                  </div>
                )}
              </div>
            </div>

            {/* Price Heatmap matrix */}
            <div className="rounded border border-zinc-900 bg-zinc-950 p-3 shadow-md">
              <h3 className="mb-2 font-mono text-[10px] font-black uppercase text-white tracking-tight">📊 SATELLITE PRICE HEATMAP</h3>
              <div className="grid grid-cols-5 gap-1 font-mono">
                {markets.slice(0, 25).map((m) => {
                  const ch = m.price_change_24h;
                  const bg =
                    ch > 10 ? 'rgba(16,185,129,0.5)' :
                    ch > 5 ? 'rgba(16,185,129,0.3)' :
                    ch > 0 ? 'rgba(16,185,129,0.15)' :
                    ch > -5 ? 'rgba(239,68,68,0.15)' :
                    ch > -10 ? 'rgba(239,68,68,0.3)' :
                    'rgba(239,68,68,0.5)';
                  return (
                    <Link
                      key={`heat-${m.id}`}
                      href={`/market/${m.id}`}
                      title={`${m.question} | Change: ${ch > 0 ? '+' : ''}${ch.toFixed(1)}%`}
                      className="flex h-7 items-center justify-center rounded font-mono text-[9px] font-black hover:opacity-80 transition hover:scale-105 border border-zinc-900 hover:border-zinc-600"
                      style={{ background: bg }}
                    >
                      {m.yes_price}
                    </Link>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[7px] text-zinc-500 font-bold uppercase tracking-wider">
                <span className="text-red-500">Bearish</span>
                <span className="text-emerald-500">Bullish</span>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
