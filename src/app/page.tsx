'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  { slug: 'sports', label: 'Sports' },
  { slug: 'economics', label: 'Economics' },
  { slug: 'culture', label: 'Culture' },
  { slug: 'science', label: 'Science' },
  { slug: 'world', label: 'World' },
  { slug: 'business', label: 'Business' },
];

const SECTIONS = [
  { label: 'Live Markets', href: '/', value: 'Dex terminal', accent: '#26a69a' },
  { label: 'Trader Board', href: '/leaderboard', value: 'Edge ranks', accent: '#3b82f6' },
  { label: 'Private Groups', href: '/groups', value: 'E2EE signals', accent: '#8b5cf6' },
  { label: 'Bots Market', href: '/bots', value: 'Agents/tools', accent: '#f59e0b' },
  { label: 'Admin Ops', href: '/admin', value: 'Control room', accent: '#ef5350' },
  { label: 'Docs/API', href: '/learn', value: 'MCP + skills', accent: '#14b8a6' },
];

const TREND_WINDOWS = [
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '12h', seconds: 43200 },
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
  if (n > 0) return '#26a69a';
  if (n < 0) return '#ef5350';
  return '#64748b';
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
  // Probability velocity: track previous YES% per market and flash the cell on change.
  const prevPricesRef = useRef<Record<string, number>>({});
  const [flashes, setFlashes] = useState<Record<string, 'up' | 'down'>>({});

  const applyFlashes = useCallback((next: Market[]) => {
    const prev = prevPricesRef.current;
    const changed: Record<string, 'up' | 'down'> = {};
    for (const m of next) {
      const before = prev[m.id];
      if (before !== undefined && before !== m.yes_price) {
        changed[m.id] = m.yes_price > before ? 'up' : 'down';
      }
      prev[m.id] = m.yes_price;
    }
    if (Object.keys(changed).length > 0) {
      setFlashes(changed);
      setTimeout(() => setFlashes({}), 650);
    }
  }, []);

  const fetchMarkets = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const r = await fetch(`/api/markets/live?cat=${cat}&page=${page}&limit=200`);
      const j: MarketsResponse = await r.json();
      let ms = j.markets || [];
      if (platformFilter !== 'all') {
        ms = ms.filter((m) => m.platform === platformFilter);
      }
      applyFlashes(ms);
      setMarkets(ms);
      setTotalPages(j.total_pages || 1);
      setPlatforms(j.platforms || {});
    } catch {
      if (!silent) setMarkets([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cat, page, platformFilter, applyFlashes]);

  const fetchTrades = useCallback(async () => {
    try {
      const r = await fetch('/api/markets/trades');
      const j = await r.json();
      setTrades((j.trades || []).slice(0, 200));
    } catch {
      setTrades([]);
    }
  }, []);

  // Reset velocity baseline whenever the filter set changes.
  useEffect(() => {
    prevPricesRef.current = {};
    setFlashes({});
  }, [cat, page, platformFilter]);

  useEffect(() => {
    fetchMarkets();
    const i = setInterval(() => fetchMarkets(true), 10000);
    return () => clearInterval(i);
  }, [fetchMarkets]);

  useEffect(() => {
    fetchTrades();
    const i = setInterval(fetchTrades, 5000);
    return () => clearInterval(i);
  }, [fetchTrades]);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const trendingTrades = trades
    .filter((t) => nowSeconds - t.timestamp <= trendWindow.seconds)
    .sort((a, b) => b.total_value - a.total_value)
    .slice(0, 20);
  const trendVolume = trendingTrades.reduce((sum, t) => sum + t.total_value, 0);
  const buyVolume = trendingTrades
    .filter((t) => t.side === 'BUY')
    .reduce((sum, t) => sum + t.total_value, 0);
  const sellVolume = Math.max(0, trendVolume - buyVolume);
  const buyShare = trendVolume ? (buyVolume / trendVolume) * 100 : 0;
  const maxLiq = markets.reduce((mx, m) => Math.max(mx, m.liquidity), 1);

  return (
    <div className="min-h-screen bg-[#090d11] text-white">
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#090d11]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-black tracking-tight text-white">
              <span className="text-blue-400">PREDICT</span>Terminal
            </Link>
            <nav className="hidden items-center gap-1 xl:flex">
              {SECTIONS.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-white/[0.04] hover:text-white"
                >
                  {s.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={platformFilter}
              onChange={(e) => {
                setPlatformFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-white/[0.08] bg-[#131722] px-2 py-1 text-[10px] text-slate-300 outline-none"
            >
              <option value="all">All Platforms</option>
              {Object.keys(platforms).map((p) => (
                <option key={p} value={p}>
                  {p} ({platforms[p]})
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                fetchMarkets();
                fetchTrades();
              }}
              className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-slate-400 hover:bg-white/[0.08] hover:text-white"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-4">
        <section className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group rounded-xl border border-white/[0.06] bg-[#131722] p-3 transition hover:border-white/[0.14] hover:bg-[#18202b]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{s.label}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: s.accent }} />
              </div>
              <div className="mt-2 text-sm font-black text-white">{s.value}</div>
              <div className="mt-1 text-[10px] text-slate-500 group-hover:text-slate-300">Open section</div>
            </Link>
          ))}
        </section>

        <section className="mb-4 grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="rounded-xl border border-white/[0.06] bg-[#131722] p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-blue-300">Prediction market terminal</div>
            <div className="mt-2 text-xl font-black text-white">Live markets across Polymarket, Kalshi, and Manifold</div>
            <div className="mt-2 text-xs text-slate-400">Dense scanner, market detail pages, smart-flow trends, trader intelligence, and private signal groups in one workspace.</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#131722] p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Markets on page</div>
            <div className="mt-2 font-mono text-2xl font-black tabular-nums text-white">{markets.length}</div>
            <div className="text-[10px] text-slate-500">Page {page} / {totalPages}</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#131722] p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Smart-flow volume</div>
            <div className="mt-2 font-mono text-2xl font-black tabular-nums text-white">{fmtN(trendVolume)}</div>
            <div className="text-[10px] text-slate-500">Last {trendWindow.label}</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#131722] p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Buy / Sell pressure</div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-red-500/30">
              <div className="bg-emerald-400" style={{ width: `${buyShare}%` }} />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums">
              <span className="text-emerald-400">{fmtN(buyVolume)}</span>
              <span className="text-red-400">{fmtN(sellVolume)}</span>
            </div>
          </div>
        </section>

        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CATS.map((c) => (
                <button
                  key={c.slug}
                  onClick={() => {
                    setCat(c.slug);
                    setPage(1);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition ${
                    cat === c.slug
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0b1016]">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-white/[0.02] text-[9px] uppercase tracking-wider text-slate-500">
                        <th className="px-2 py-2.5 font-medium" style={{ width: 36 }}>#</th>
                        <th className="px-2 py-2.5 font-medium">Market</th>
                        <th className="px-2 py-2.5 font-medium text-right" style={{ width: 64 }}>Prob</th>
                        <th className="px-2 py-2.5 font-medium text-right">MCAP</th>
                        <th className="px-2 py-2.5 font-medium text-right">Volume</th>
                        <th className="px-2 py-2.5 font-medium" style={{ width: 110 }}>Liquidity</th>
                        <th className="px-2 py-2.5 font-medium text-right">Txns</th>
                        <th className="px-2 py-2.5 font-medium text-right">Traders</th>
                        <th className="px-2 py-2.5 font-medium text-right">Age</th>
                        <th className="px-2 py-2.5 font-medium text-right">5M</th>
                        <th className="px-2 py-2.5 font-medium text-right">1H</th>
                        <th className="px-2 py-2.5 font-medium text-right">6H</th>
                        <th className="px-2 py-2.5 font-medium text-right">24H</th>
                        <th className="px-2 py-2.5 font-medium text-center" style={{ width: 92 }}>Sentiment</th>
                        <th className="px-2 py-2.5 font-medium" style={{ width: 24 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {markets.map((m, idx) => {
                        const globalIdx = (page - 1) * 200 + idx + 1;
                        const yesW = Math.max(0, Math.min(100, m.yes_price));
                        const noW = Math.max(0, Math.min(100, m.no_price));
                        return (
                          <tr key={m.id} className="border-t border-white/[0.035] transition-colors hover:bg-white/[0.025]">
                            <td className="px-2 py-2 font-mono text-slate-600">{globalIdx}</td>
                            <td className="px-2 py-2">
                              <Link href={`/market/${m.id}`} className="flex items-center gap-2 text-white hover:text-blue-400">
                                {m.image_url ? (
                                  <img src={m.image_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                                ) : (
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[8px] font-bold text-slate-300">
                                    {initials(m.question)}
                                  </div>
                                )}
                                <span className="max-w-[340px] truncate text-[11px] font-semibold">{m.question}</span>
                                <span className="rounded px-1 py-0.5 text-[7px] font-bold capitalize text-slate-500" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                  {m.platform}
                                </span>
                              </Link>
                            </td>
                            <td className="px-2 py-2 text-right">
                              <span
                                className={`inline-block px-1 font-mono text-[12px] font-black tabular-nums ${flashes[m.id] === 'up' ? 'tick-up' : flashes[m.id] === 'down' ? 'tick-down' : ''}`}
                                style={{ color: flashes[m.id] ? undefined : '#26a69a' }}
                              >
                                {m.yes_price}%
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-300">{fmtN(m.mcap)}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-300">{fmtN(m.volume_24h)}</td>
                            <td className="px-2 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="font-mono text-slate-300">{fmtN(m.liquidity)}</span>
                                <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.06]">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{ width: `${Math.max(4, Math.min(100, (m.liquidity / maxLiq) * 100))}%`, background: m.liquidity / maxLiq > 0.5 ? '#26a69a' : m.liquidity / maxLiq > 0.2 ? '#3b82f6' : '#64748b' }}
                                  />
                                </span>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-300">{m.txns.toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-300">{m.traders.toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-400">{fmtAge(m.age_hours)}</td>
                            {[m.price_change_5m, m.price_change_1h, m.price_change_6h, m.price_change_24h].map((v, i) => (
                              <td key={i} className="px-2 py-2 text-right font-mono" style={{ color: clsC(v) }}>
                                {v > 0 ? '+' : ''}{v.toFixed(1)}%
                              </td>
                            ))}
                            <td className="px-2 py-2">
                              <div className="mx-auto flex h-1.5 overflow-hidden rounded-full" style={{ width: 74, background: 'rgba(239,83,80,0.25)' }}>
                                <div className="h-full" style={{ width: `${yesW}%`, background: '#26a69a' }} />
                                <div className="h-full" style={{ width: `${noW}%`, background: '#ef5350' }} />
                              </div>
                              <div className="mt-0.5 flex justify-between font-mono text-[7px] font-bold">
                                <span style={{ color: '#26a69a' }}>{yesW}</span>
                                <span style={{ color: '#ef5350' }}>{noW}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <a href={m.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-blue-400" title="Open external">
                                /
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                      {markets.length === 0 && (
                        <tr>
                          <td colSpan={15} className="py-12 text-center text-xs text-slate-500">No markets found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Page {page} of {totalPages} - {markets.length} markets</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="rounded-lg bg-white/[0.04] px-3 py-1 text-[10px] font-medium text-slate-400 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="rounded-lg bg-white/[0.04] px-3 py-1 text-[10px] font-medium text-slate-400 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <aside className="hidden w-[320px] shrink-0 space-y-4 lg:block">
            <div className="rounded-xl border border-white/[0.06] bg-[#131722] p-3">
              <h3 className="mb-2 text-[11px] font-semibold text-white">Platforms</h3>
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setPlatformFilter('all');
                    setPage(1);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] ${
                    platformFilter === 'all' ? 'bg-white/[0.06] text-white' : 'text-slate-400 hover:bg-white/[0.03] hover:text-white'
                  }`}
                >
                  <span>All Platforms</span>
                </button>
                {Object.entries(platforms).map(([p, cnt]) => (
                  <button
                    key={p}
                    onClick={() => {
                      setPlatformFilter(p);
                      setPage(1);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] capitalize ${
                      platformFilter === p ? 'bg-white/[0.06] text-white' : 'text-slate-400 hover:bg-white/[0.03] hover:text-white'
                    }`}
                  >
                    <span>{p}</span>
                    <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: 'rgba(255,255,255,0.06)' }}>{cnt}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-[#131722] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold text-white">Smart Flow Trends</h3>
                <div className="flex rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
                  {TREND_WINDOWS.map((w) => (
                    <button
                      key={w.label}
                      type="button"
                      onClick={() => setTrendWindow(w)}
                      className={`rounded-md px-1.5 py-0.5 text-[8px] font-bold ${trendWindow.label === w.label ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-white'}`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <div className="text-[8px] uppercase text-slate-500">Flow</div>
                  <div className="font-mono text-[12px] font-black text-white">{fmtN(trendVolume)}</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <div className="text-[8px] uppercase text-slate-500">Buys</div>
                  <div className="font-mono text-[12px] font-black text-emerald-400">{fmtN(buyVolume)}</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-2">
                  <div className="text-[8px] uppercase text-slate-500">Sells</div>
                  <div className="font-mono text-[12px] font-black text-red-400">{fmtN(sellVolume)}</div>
                </div>
              </div>
              <div className="space-y-1">
                {trendingTrades.map((t, i) => (
                  <div key={t.id + '-' + i} className="flex items-center gap-2 rounded-lg bg-white/[0.01] px-2 py-1.5">
                    <span className="w-4 font-mono text-[8px] text-slate-600">#{i + 1}</span>
                    <span
                      className="rounded px-1 py-0.5 text-[7px] font-bold"
                      style={{
                        background: t.side === 'BUY' ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)',
                        color: t.side === 'BUY' ? '#26a69a' : '#ef5350',
                      }}
                    >
                      {t.side}
                    </span>
                    <span className={`text-[9px] font-bold ${t.outcome === 'YES' ? 'text-emerald-400' : 'text-red-400'}`}>{t.outcome}</span>
                    <span className="font-mono text-[9px] font-bold text-white">{fmtN(t.total_value)}</span>
                    <span className="font-mono text-[9px] text-slate-400">{(t.price * 100).toFixed(1)}c</span>
                    <span className="ml-auto text-[8px] text-slate-600">{t.time_ago}</span>
                  </div>
                ))}
                {trendingTrades.length === 0 && (
                  <div className="py-4 text-center text-[10px] text-slate-500">No highlighted flow in this window...</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-[#131722] p-3">
              <h3 className="mb-2 text-[11px] font-semibold text-white">Heatmap</h3>
              <div className="grid grid-cols-5 gap-1">
                {markets.slice(0, 25).map((m) => {
                  const ch = m.price_change_24h;
                  const bg =
                    ch > 10 ? 'rgba(38,166,154,0.5)' :
                    ch > 5 ? 'rgba(38,166,154,0.3)' :
                    ch > 0 ? 'rgba(38,166,154,0.15)' :
                    ch > -5 ? 'rgba(239,83,80,0.15)' :
                    ch > -10 ? 'rgba(239,83,80,0.3)' :
                    'rgba(239,83,80,0.5)';
                  return (
                    <Link
                      key={m.id}
                      href={`/market/${m.id}`}
                      title={`${m.question} ${ch > 0 ? '+' : ''}${ch.toFixed(1)}%`}
                      className="flex h-8 items-center justify-center rounded font-mono text-[7px] font-bold hover:opacity-80"
                      style={{ background: bg }}
                    >
                      {m.yes_price}
                    </Link>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between text-[7px] text-slate-600">
                <span>Bearish</span>
                <span>Bullish</span>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
