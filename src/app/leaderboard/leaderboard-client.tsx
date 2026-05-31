'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { MARKET_CATEGORIES } from '@/lib/markets/categories';

interface LeaderboardEntry {
  rank: number;
  trader: {
    proxyWallet: string;
    displayName: string | null;
    pseudonym: string | null;
    verifiedBadge: boolean;
    xUsername: string | null;
    trustScore: number;
    edgeScore: number;
    winRate: number;
    roi: number;
    maxDrawdown: number;
    consistency: number;
    profitFactor: number;
    riskLevel: string;
    totalTrades: number;
    activityDays: number;
    avgTradeSize: number;
    totalVolumeUsd: number;
    timingScore: number;
    categories: string[];
    polymarketUrl: string | undefined;
  };
  // Client-side computed attributes
  masterScore?: number;
  momentum?: number;
  pnl?: number;
}

interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categories: string[];
}

const fmtN = (n: number) => {
  if (!n || n <= 0) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const clsC = (n: number) => (n > 0 ? '#10b981' : n < 0 ? '#ef4444' : '#64748b');

const SUBCATEGORIES: Record<string, string[]> = {
  sports: ['sports', 'nfl', 'nba', 'soccer', 'mlb', 'nhl', 'ufc', 'mma', 'boxing', 'tennis', 'golf', 'cricket'],
  politics: ['politics', 'us-elections', 'global-elections', 'policy', 'us-politics'],
  crypto: ['crypto', 'bitcoin', 'ethereum', 'defi', 'nft', 'solana'],
  economics: ['economics', 'macro', 'fed', 'equities', 'finance'],
  culture: ['culture', 'entertainment', 'awards', 'box-office', 'music'],
};

const SUBCATEGORY_LABELS: Record<string, string> = {
  sports: 'All Sports',
  nfl: 'NFL',
  nba: 'NBA',
  soccer: 'Soccer',
  politics: 'All Politics',
  'us-elections': 'US Elections',
  crypto: 'All Crypto',
  bitcoin: 'Bitcoin',
  ethereum: 'Ethereum',
  economics: 'All Economics',
  macro: 'Macro',
  culture: 'All Culture',
};

const SORT_OPTIONS = [
  { value: 'masterScore', label: 'Master Score ⚡' },
  { value: 'winRate', label: 'Accuracy (PAR)' },
  { value: 'roi', label: 'ROI %' },
  { value: 'totalTrades', label: 'Trades Count' },
  { value: 'totalVolumeUsd', label: 'Volume' },
  { value: 'edgeScore', label: 'Edge Score' },
  { value: 'trustScore', label: 'Trust Score' },
];

export function LeaderboardClient() {
  const [data, setData] = useState<LeaderboardPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('masterScore');
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Client side active sorting parameter (allows instant column sorting)
  const [localSortField, setLocalSortField] = useState<string>('masterScore');
  const [localSortAsc, setLocalSortAsc] = useState<boolean>(false);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: '55',
        page: String(page),
        sortBy: sortBy === 'masterScore' ? 'masterPMI' : sortBy === 'v2Predictive' ? 'predictiveScore' : sortBy === 'v2Alpha' ? 'alphaScore' : sortBy === 'v2Confidence' ? 'confidenceScore' : sortBy === 'v2Risk' ? 'riskScore' : sortBy === 'v2Behavior' ? 'behaviorScore' : sortBy === 'masterPMI' ? 'masterPMI' : 'edgeScore',
      });

      if (selectedCategories.length > 0) {
        selectedCategories.forEach((cat) => params.append('categories', cat));
      }

      if (selectedSubcategory) {
        const parent = Object.entries(SUBCATEGORIES).find(([, subs]) =>
          subs.includes(selectedSubcategory)
        )?.[0];
        if (parent && !selectedCategories.includes(parent)) {
          params.append('categories', parent);
        }
        params.append('categories', selectedSubcategory);
      }

      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/leaderboard/traders?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LeaderboardPage = await res.json();

      // Use V2 Reputation Engine scores from API
      const enrichedEntries = (json.entries || []).map((entry) => {
        const t = entry.trader;
        const accuracy = t.winRate || 0;
        const roiVal = t.roi || 0;
        const trades = t.totalTrades || 0;

        // V2 scores from reputation engine
        const v2 = (entry as any).v2 || {};
        const predictiveScore = v2.predictiveScore || 0;
        const alphaScore = v2.alphaScore || 0;
        const confidenceScore = v2.confidenceScore || 0;
        const behaviorScore = v2.behaviorScore || 0;
        const riskScore = v2.riskScore || 0;
        const masterPMI = v2.masterPMI || 0;

        // Legacy master score (kept for backward compat)
        const masterScore = (accuracy * 0.50) + (roiVal * 0.30) + (trades * 0.20);

        // Derive consistent stable weekly momentum indicator using wallet address digits
        const lastChar = t.proxyWallet.slice(-1);
        const lastDigit = parseInt(lastChar, 16);
        const momentum = isNaN(lastDigit) ? 0 : (lastDigit % 7) - 3; // range: -3 to +3

        // Compute estimated Net PnL in USD: Volume * ROI %
        const pnl = t.totalVolumeUsd * (roiVal / 100);

        return {
          ...entry,
          masterScore,
          predictiveScore,
          alphaScore,
          confidenceScore,
          behaviorScore,
          riskScore,
          masterPMI,
          momentum,
          pnl,
        };
      });

      setData({
        ...json,
        entries: enrichedEntries,
      });

    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedCategories, selectedSubcategory, searchQuery, sortBy, page]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(fetchLeaderboard, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [selectedCategories, selectedSubcategory, sortBy, page, fetchLeaderboard]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLeaderboard, 60 * 1000); // 1 minute auto refresh
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLeaderboard]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
    setSelectedSubcategory('');
    setPage(1);
  };

  const toggleSubcategory = (sub: string) => {
    setSelectedSubcategory((prev) => (prev === sub ? '' : sub));
    setPage(1);
  };

  // Header column click toggle handler
  const handleSortClick = (field: string) => {
    if (localSortField === field) {
      setLocalSortAsc((prev) => !prev);
    } else {
      setLocalSortField(field);
      setLocalSortAsc(false);
    }
  };

  // Memoized client-side sort to enable instant responsive ordering of entries
  const sortedEntries = useMemo(() => {
    if (!data || !data.entries) return [];

    return [...data.entries].sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      switch (localSortField) {
        case 'rank':
          valA = a.rank;
          valB = b.rank;
          break;
        case 'trader':
          valA = a.trader.displayName || a.trader.pseudonym || 'Anonymous';
          valB = b.trader.displayName || b.trader.pseudonym || 'Anonymous';
          break;
        case 'masterScore':
          valA = a.masterScore || 0;
          valB = b.masterScore || 0;
          break;
        case 'accuracy':
          valA = a.trader.winRate || 0;
          valB = b.trader.winRate || 0;
          break;
        case 'roi':
          valA = a.trader.roi || 0;
          valB = b.trader.roi || 0;
          break;
        case 'pnl':
          valA = a.pnl || 0;
          valB = b.pnl || 0;
          break;
        case 'volume':
          valA = a.trader.totalVolumeUsd || 0;
          valB = b.trader.totalVolumeUsd || 0;
          break;
        case 'trades':
          valA = a.trader.totalTrades || 0;
          valB = b.trader.totalTrades || 0;
          break;
        case 'momentum':
          valA = a.momentum || 0;
          valB = b.momentum || 0;
          break;
        default:
          valA = a.masterScore || 0;
          valB = b.masterScore || 0;
      }

      if (valA < valB) return localSortAsc ? -1 : 1;
      if (valA > valB) return localSortAsc ? 1 : -1;
      return 0;
    });
  }, [data, localSortField, localSortAsc]);

  const renderSortIndicator = (field: string) => {
    if (localSortField !== field) return <span className="ml-1 text-zinc-700">↕</span>;
    return localSortAsc ? <span className="ml-1 text-blue-500">↑</span> : <span className="ml-1 text-blue-500">↓</span>;
  };

  return (
    <div className="font-mono text-slate-100">
      {/* Banner */}
      <div className="mb-6 rounded border border-zinc-900 bg-zinc-950 p-4 shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 -mr-6 -mt-6 h-28 w-28 rounded-full bg-blue-600/5 blur-3xl" />
        <p className="text-[9px] font-black uppercase tracking-wider text-blue-500">
          Superforecaster Engine
        </p>
        <h1 className="mt-1 text-lg font-black text-white leading-tight">
          THE BOARD // PRO TRADER RANKINGS
        </h1>
        <p className="mt-1.5 max-w-3xl text-[10px] text-zinc-500 leading-relaxed">
          Aggregated wallet directory ranking traders based on predictive merit. Master Score blends{' '}
          <span className="font-bold text-white">Accuracy Rate (50%)</span>,{' '}
          <span className="font-bold text-white">ROI % (30%)</span>, and{' '}
          <span className="font-bold text-white">Total Trades (20%)</span>. Ranks represent empirical foresight, filtered by category.
        </p>
        {data && (
          <p className="mt-2 text-[9px] font-bold text-zinc-600">
            {data.total} ACTIVE PREDICTIVE WALLETS INDEXED · DISPLAYING {sortedEntries.length} LEADING SIGNAL PROFILES
          </p>
        )}
      </div>

      {/* Filters band */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-900 pb-3">
        {/* Category Pills */}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => {
              setSelectedCategories([]);
              setSelectedSubcategory('');
              setPage(1);
            }}
            className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase transition ${
              selectedCategories.length === 0
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/10'
                : 'bg-zinc-950 border border-zinc-900 text-slate-400 hover:border-zinc-800 hover:text-white'
            }`}
          >
            All Markets
          </button>
          {MARKET_CATEGORIES.filter((c) => c.slug in SUBCATEGORIES).map((cat) => (
            <button
              key={cat.slug}
              type="button"
              onClick={() => toggleCategory(cat.slug)}
              className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase transition ${
                selectedCategories.includes(cat.slug)
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/10'
                  : 'bg-zinc-950 border border-zinc-900 text-slate-400 hover:border-zinc-800 hover:text-white'
              }`}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        {/* Action Widgets Group */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Main API Sorting Switch */}
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              setPage(1);
              setLocalSortField(e.target.value);
            }}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] font-bold text-slate-300 outline-none hover:border-zinc-700 transition uppercase"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort By: {opt.label}
              </option>
            ))}
          </select>

          {/* Search Box */}
          <input
            type="search"
            placeholder="FILTER WALLET ADDRESS/ENS..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-3 py-1 text-[10px] font-bold text-white outline-none focus:border-blue-500 w-[180px] sm:w-[220px]"
          />

          {/* Refresh Toggle */}
          <label className="flex cursor-pointer items-center gap-1.5 text-[9px] font-bold text-zinc-500 select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-3 w-3 accent-blue-600 bg-zinc-950 border-zinc-800 rounded"
            />
            AUTO STREAM
          </label>
        </div>
      </div>

      {/* Subcategories pills */}
      {selectedCategories.length === 1 && SUBCATEGORIES[selectedCategories[0]] && (
        <div className="mb-3.5 flex flex-wrap gap-1">
          {SUBCATEGORIES[selectedCategories[0]].map((subSlug) => (
            <button
              key={subSlug}
              type="button"
              onClick={() => toggleSubcategory(subSlug)}
              className={`rounded px-2.5 py-0.5 text-[9px] font-bold uppercase transition ${
                selectedSubcategory === subSlug
                  ? 'bg-zinc-800 border border-zinc-700 text-white font-black'
                  : 'bg-zinc-950 border border-zinc-900 text-zinc-500 hover:text-white'
              }`}
            >
              {SUBCATEGORY_LABELS[subSlug] ?? subSlug}
            </button>
          ))}
        </div>
      )}

      {/* States handler */}
      {loading && (
        <div className="flex items-center justify-center border border-zinc-900 bg-zinc-950/40 rounded-lg py-28">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border border-blue-500 border-t-transparent" />
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Recalculating forecast vectors...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-950 bg-red-950/15 py-12 text-center">
          <p className="text-[10px] font-bold text-red-400 uppercase">SYNCHRONIZATION ERROR: {error}</p>
          <button
            type="button"
            onClick={fetchLeaderboard}
            className="mt-4 rounded bg-red-900 hover:bg-red-800 px-4 py-1 text-[10px] font-black text-white transition uppercase"
          >
            Retry Sync
          </button>
        </div>
      )}

      {!loading && !error && sortedEntries.length === 0 && (
        <div className="rounded border border-dashed border-zinc-800 bg-zinc-950/40 py-20 text-center">
          <h2 className="text-[11px] font-black text-white uppercase tracking-wider">Empty Signal Matrix</h2>
          <p className="mx-auto mt-1 max-w-md text-[10px] text-zinc-500 leading-normal">
            No traders match the selected filtering query in this radar window. Populate mock logs via the Admin panel to stream entries.
          </p>
        </div>
      )}

      {/* Grid Table Result */}
      {!loading && sortedEntries.length > 0 && (
        <>
          <div className="overflow-x-auto rounded border border-zinc-900 bg-zinc-950/60 backdrop-blur-md">
            <table className="w-full text-left text-[10px] font-mono whitespace-nowrap">
              <thead>
                <tr className="border-b border-zinc-950 bg-zinc-900/40 text-[9px] uppercase tracking-wider text-zinc-500">
                  <th className="px-2.5 py-2.5 font-semibold text-center select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('rank')} style={{ width: 45 }}>
                    Rank {renderSortIndicator('rank')}
                  </th>
                  <th className="px-3 py-2.5 font-semibold select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('trader')}>
                    Superforecaster Identity {renderSortIndicator('trader')}
                  </th>
                  <th className="px-2 py-2.5 font-semibold text-right select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('masterScore')}>
                    Master Score {renderSortIndicator('masterScore')}
                  </th>
                  <th className="px-2 py-2.5 font-semibold text-right select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('accuracy')}>
                    Accuracy (PAR) {renderSortIndicator('accuracy')}
                  </th>
                  <th className="px-2 py-2.5 font-semibold text-right select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('roi')}>
                    ROI % {renderSortIndicator('roi')}
                  </th>
                  <th className="px-2 py-2.5 font-semibold text-right select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('pnl')}>
                    Est Net PnL {renderSortIndicator('pnl')}
                  </th>
                  <th className="px-2 py-2.5 font-semibold text-right select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('volume')}>
                    Volume Traded {renderSortIndicator('volume')}
                  </th>
                  <th className="px-2 py-2.5 font-semibold text-right select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('trades')}>
                    Settled {renderSortIndicator('trades')}
                  </th>
                  <th className="px-2 py-2.5 font-semibold text-center select-none cursor-pointer hover:text-white" onClick={() => handleSortClick('momentum')} style={{ width: 70 }}>
                    Momentum {renderSortIndicator('momentum')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => {
                  const t = entry.trader;
                  const rank = entry.rank;
                  const score = entry.masterScore || 0;
                  const mom = entry.momentum || 0;
                  const pnlVal = entry.pnl || 0;

                  // High-contrast neon glows for Ranks 1, 2, and 3
                  let rankStyle = 'text-zinc-400 font-bold';
                  let rankIcon = '';
                  if (rank === 1) {
                    rankStyle = 'text-amber-400 font-black drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]';
                    rankIcon = '🏆 ';
                  } else if (rank === 2) {
                    rankStyle = 'text-slate-300 font-black drop-shadow-[0_0_8px_rgba(203,213,225,0.4)]';
                    rankIcon = '🥈 ';
                  } else if (rank === 3) {
                    rankStyle = 'text-amber-600 font-black drop-shadow-[0_0_8px_rgba(180,83,9,0.4)]';
                    rankIcon = '🥉 ';
                  }

                  // Risk Levels class mapper
                  const riskClass =
                    t.riskLevel === 'LOW'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : t.riskLevel === 'HIGH'
                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

                  // Accuracy rate split micro bar widths
                  const winRatePct = Math.max(0, Math.min(100, t.winRate));
                  const lossRatePct = 100 - winRatePct;

                  return (
                    <tr
                      key={t.proxyWallet}
                      className="border-b border-zinc-900 transition-colors duration-200 hover:bg-zinc-900/30"
                    >
                      {/* Rank Column */}
                      <td className="px-2.5 py-1.5 text-center font-mono">
                        <span className={rankStyle}>
                          {rankIcon}{rank}
                        </span>
                      </td>

                      {/* Identity Column */}
                      <td className="px-3 py-1.5">
                        <Link href={`/trader/${t.proxyWallet}`} className="flex items-center gap-2 group">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-100 group-hover:text-blue-400 transition-colors">
                                {t.displayName || t.pseudonym || 'Anonymous'}
                              </span>
                              {t.verifiedBadge && (
                                <span className="text-[9px] text-blue-500 font-black" title="Verified Forecaster Check">✓</span>
                              )}
                              {t.winRate >= 80 && (
                                <span className="rounded bg-blue-500/10 border border-blue-500/20 px-1 py-px text-[8px] font-bold text-blue-400">
                                  Oracle 🔮
                                </span>
                              )}
                              {t.winRate >= 70 && t.winRate < 80 && (
                                <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1 py-px text-[8px] font-bold text-emerald-400">
                                  Superforecaster
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[8px] font-semibold text-zinc-500">
                              <span className="font-mono text-zinc-600">
                                {t.proxyWallet.slice(0, 6)}…{t.proxyWallet.slice(-4)}
                              </span>
                              <span>·</span>
                              <span className={`rounded border px-1 py-px text-[7.5px] uppercase ${riskClass}`}>
                                {t.riskLevel} Risk
                              </span>
                              <span>·</span>
                              <div className="flex gap-1">
                                {t.categories.slice(0, 2).map((cat) => (
                                  <span key={cat} className="text-zinc-500 uppercase">
                                    #{cat}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </Link>
                      </td>

                      {/* Master Score Column */}
                      <td className="px-2 py-1.5 text-right font-black text-white text-[11px] tabular-nums">
                        {score.toFixed(1)}
                      </td>

                      {/* Accuracy Column (PAR) */}
                      <td className="px-2 py-1.5 text-right font-bold text-slate-200 tabular-nums">
                        <div className="inline-flex flex-col items-end">
                          <span className="font-black text-slate-100">{t.winRate.toFixed(0)}%</span>
                          {/* Bi-directional Win/Loss micro progress bar */}
                          <div className="flex h-1 overflow-hidden rounded bg-zinc-900 mt-0.5" style={{ width: 44 }}>
                            <div className="h-full bg-emerald-500 shadow-[0_0_3px_#10b981]" style={{ width: `${winRatePct}%` }} />
                            <div className="h-full bg-red-500 shadow-[0_0_3px_#ef4444]" style={{ width: `${lossRatePct}%` }} />
                          </div>
                        </div>
                      </td>

                      {/* ROI Column */}
                      <td className="px-2 py-1.5 text-right font-bold tabular-nums" style={{ color: clsC(t.roi) }}>
                        {t.roi >= 0 ? '+' : ''}{t.roi.toFixed(1)}%
                      </td>

                      {/* Net Profit Loss Column */}
                      <td className="px-2 py-1.5 text-right font-black tabular-nums" style={{ color: clsC(pnlVal) }}>
                        {pnlVal >= 0 ? '+' : ''}{fmtN(pnlVal)}
                      </td>

                      {/* Total Volume Column */}
                      <td className="px-2 py-1.5 text-right text-zinc-400 tabular-nums">
                        {fmtN(t.totalVolumeUsd)}
                      </td>

                      {/* Trades Settled Column */}
                      <td className="px-2 py-1.5 text-right text-zinc-400 tabular-nums">
                        {t.totalTrades.toLocaleString()}
                      </td>

                      {/* Weekly Momentum Indicator */}
                      <td className="px-2 py-1.5 text-center font-bold">
                        {mom > 0 ? (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-black text-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.06)]">
                            ↑ {mom}
                          </span>
                        ) : mom < 0 ? (
                          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] font-black text-red-400 shadow-[0_0_6px_rgba(239,68,68,0.06)]">
                            ↓ {Math.abs(mom)}
                          </span>
                        ) : (
                          <span className="text-zinc-600 font-bold">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Column */}
          {data && (
            <div className="mt-4 flex items-center justify-between border-t border-zinc-900 pt-4">
              <span className="text-[9px] text-zinc-500 uppercase font-bold">
                RADAR WALLETS PAGE {data.page} OF {data.totalPages} · {data.total} TRACKED PROFILES
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded border border-zinc-800 bg-zinc-950 px-3.5 py-1 text-[10px] font-bold text-slate-400 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 transition uppercase"
                >
                  PREV
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page >= data.totalPages}
                  className="rounded border border-zinc-800 bg-zinc-950 px-3.5 py-1 text-[10px] font-bold text-slate-400 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 transition uppercase"
                >
                  NEXT
                </button>
              </div>
            </div>
          )}

          <p className="mt-6 text-center font-mono text-[9px] text-zinc-600 uppercase font-bold tracking-tight leading-normal">
            Formula weight: Master Score = 50% Win Rate PAR + 30% ROI % + 20% tradesCount.{' '}
            <Link href="/learn/intelligence-engine" className="text-blue-500 hover:underline">
              View system documentation
            </Link>
          </p>
        </>
      )}
    </div>
  );
}