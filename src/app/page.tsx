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
}

const CATS = [
  { slug: 'all', label: 'All', emoji: '◉' },
  { slug: 'politics', label: 'Politics', emoji: '🏛' },
  { slug: 'crypto', label: 'Crypto', emoji: '₿' },
  { slug: 'sports', label: 'Sports', emoji: '⚽' },
  { slug: 'economics', label: 'Macro', emoji: '📊' },
  { slug: 'science', label: 'Tech', emoji: '🔬' },
  { slug: 'culture', label: 'Culture', emoji: '🎬' },
];

function fmtN(n: number): string {
  if (!n || n <= 0) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function clsC(n: number): string {
  if (n > 0) return '#22c55e';
  if (n < 0) return '#ef4444';
  return '#64748b';
}

function initials(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) || 'PM';
}

function fmtAge(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export default function HomePage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [cat, setCat] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        cat,
        page: String(page),
        limit: '200',
        maxPages: '100',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const r = await fetch(`/api/markets/live?${params}`);
      const j = await r.json();
      setMarkets(j.markets || []);
      setTotalPages(j.total_pages || 1);
    } catch {
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, [cat, page, debouncedSearch]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  // Poll every 30s for fresh data
  useEffect(() => {
    const i = setInterval(fetchMarkets, 30000);
    return () => clearInterval(i);
  }, [fetchMarkets]);

  const maxLiq = Math.max(...markets.map((m) => m.liquidity), 1);

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[#111827] bg-[#030712]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1720px] items-center justify-between px-4 py-2">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-black text-white tracking-tight">
              <span className="text-blue-400">NICHE</span>TRUST
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {[
                { label: 'Markets', href: '/' },
                { label: 'Leaderboard', href: '/leaderboard' },
                { label: 'Groups', href: '/groups' },
                { label: 'Bots', href: '/bots' },
                { label: 'Learn', href: '/learn' },
              ].map((s) => (
                <Link key={s.href} href={s.href} className="rounded px-2 py-1 text-[11px] font-bold text-zinc-400 hover:bg-[#111827] hover:text-white transition-colors">
                  {s.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search markets..."
                className="w-44 rounded border border-[#1f2937] bg-[#0b1120] px-2.5 py-1 text-[10px] text-white placeholder-zinc-600 outline-none focus:border-blue-500 transition"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-[10px]">✕</button>
              )}
            </div>
            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              LIVE
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1720px] px-4 py-3">
        {/* Category Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {CATS.map((c) => (
            <button
              key={c.slug}
              onClick={() => { setCat(c.slug); setPage(1); }}
              className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-tight transition-colors ${
                cat === c.slug
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#0b1120] border border-[#1f2937] text-zinc-400 hover:border-zinc-600 hover:text-white'
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center rounded border border-[#111827] bg-[#0b1120] py-24">
            <div className="flex flex-col items-center gap-2">
              <div className="h-5 w-5 animate-spin rounded-full border border-blue-500 border-t-transparent" />
              <span className="text-[10px] text-zinc-500 font-mono">LOADING MARKETS...</span>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded border border-[#111827] bg-[#0b1120]">
              <table className="w-full border-collapse text-[11px]" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="border-b border-[#111827] bg-[#030712] text-[9px] uppercase tracking-wider text-zinc-500">
                    <th className="py-2 text-left font-semibold" style={{ width: 44, paddingLeft: 12 }}>#</th>
                    <th className="py-2 text-left font-semibold" style={{ width: 320 }}>Market</th>
                    <th className="py-2 text-right font-semibold" style={{ width: 68 }}>Prob</th>
                    <th className="py-2 text-right font-semibold" style={{ width: 72 }}>1h</th>
                    <th className="py-2 text-right font-semibold" style={{ width: 72 }}>24h</th>
                    <th className="py-2 text-right font-semibold" style={{ width: 80 }}>Volume</th>
                    <th className="py-2 text-right font-semibold" style={{ width: 80 }}>MCAP</th>
                    <th className="py-2 font-semibold" style={{ width: 110 }}>Liquidity</th>
                    <th className="py-2 text-right font-semibold" style={{ width: 56 }}>Txns</th>
                    <th className="py-2 text-center font-semibold" style={{ width: 70 }}>Sent.</th>
                    <th className="py-2 text-right font-semibold" style={{ width: 56 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m, idx) => {
                    const globalIdx = (page - 1) * 100 + idx + 1;
                    const yesW = Math.max(0, Math.min(100, m.yes_price));
                    const noW = Math.max(0, Math.min(100, m.no_price));
                    const liqPct = Math.max(2, Math.min(100, (m.liquidity / maxLiq) * 100));
                    return (
                      <tr key={m.id} className="border-b border-[#111827]/60 transition-colors hover:bg-[#111827]/30">
                        <td className="py-1.5 text-zinc-600 font-mono" style={{ paddingLeft: 12 }}>{globalIdx}</td>
                        <td className="py-1.5" style={{ paddingRight: 8 }}>
                          <Link href={`/market/${m.id}`} className="flex items-center gap-2 group">
                            {m.image_url ? (
                              <img src={m.image_url} alt="" className="h-5 w-5 rounded-full object-cover border border-zinc-800 shrink-0" />
                            ) : (
                              <div className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 text-[8px] font-bold text-zinc-400 border border-zinc-700 shrink-0">
                                {initials(m.question)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-white font-medium text-[11px] leading-tight group-hover:text-blue-400 transition-colors" title={m.question}>
                                {m.question}
                              </span>
                            </div>
                          </Link>
                        </td>
                        <td className="py-1.5 text-right">
                          <span className="font-mono font-bold text-emerald-400 text-[11px]">{yesW}%</span>
                        </td>
                        <td className="py-1.5 text-right font-mono font-medium" style={{ color: clsC(m.price_change_1h) }}>
                          {m.price_change_1h >= 0 ? '+' : ''}{m.price_change_1h.toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-right font-mono font-medium" style={{ color: clsC(m.price_change_24h) }}>
                          {m.price_change_24h >= 0 ? '+' : ''}{m.price_change_24h.toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-right font-mono text-zinc-300 text-[11px]">{fmtN(m.volume_24h)}</td>
                        <td className="py-1.5 text-right font-mono text-zinc-300 text-[11px]">{fmtN(m.mcap)}</td>
                        <td className="py-1.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="h-1 w-10 overflow-hidden rounded-full bg-zinc-800">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${liqPct}%` }} />
                            </div>
                            <span className="font-mono text-zinc-400 text-[10px] w-10 text-right">{fmtN(m.liquidity)}</span>
                          </div>
                        </td>
                        <td className="py-1.5 text-right font-mono text-zinc-500">{m.txns.toLocaleString()}</td>
                        <td className="py-1.5">
                          <div className="mx-auto flex h-1 overflow-hidden rounded bg-zinc-800" style={{ width: 52 }}>
                            <div className="h-full bg-emerald-500" style={{ width: `${yesW}%` }} />
                            <div className="h-full bg-red-500" style={{ width: `${noW}%` }} />
                          </div>
                        </td>
                        <td className="py-1.5 text-right">
                          <Link href={`/market/${m.id}`} className="font-mono font-bold text-blue-500 hover:text-blue-400 text-[10px] transition-colors">
                            Trade →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {markets.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-16 text-center text-zinc-600 text-[11px]">
                        No markets found{debouncedSearch ? ` for "${debouncedSearch}"` : ''} in this category
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-zinc-600">
                {markets.length} markets · Page {page} of {totalPages}
              </span>
              {totalPages > 1 && (
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded border border-zinc-800 bg-[#0b1120] px-2.5 py-0.5 text-[10px] font-bold text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded border border-zinc-800 bg-[#0b1120] px-2.5 py-0.5 text-[10px] font-bold text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
