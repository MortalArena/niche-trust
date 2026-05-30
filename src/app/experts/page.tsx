import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { StarRating } from '@/components/star-rating';
import { getExpertServiceRating } from '@/lib/reviews/service';
import { getLeaderboard, getIntelligenceStats } from '@/lib/polymarket/leaderboard';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ExpertsPage() {
  const [pmLeaders, allExperts, stats] = await Promise.all([
    getLeaderboard({ limit: 20, sortBy: 'trustScore' }),
    prisma.polymarketTrader.findMany({
      where: { trustScore: { gt: 0 }, totalTrades: { gt: 0 } },
      orderBy: { trustScore: 'desc' },
      take: 50,
    }),
    getIntelligenceStats(),
  ]);

  const serviceRatings = await Promise.all(
    allExperts.slice(0, 20).map((e) => getExpertServiceRating(e.proxyWallet))
  );

  const pmTop10 = pmLeaders.entries.slice(0, 10);

  return (
    <PageShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">Experts & Intelligence</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {stats.traderCount.toLocaleString()} Polymarket wallets indexed with verified trust scores — updated every 60 seconds.
          </p>
        </div>
        <Link
          href="/leaderboard"
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Full intelligence leaderboard →
        </Link>
      </div>

      {/* Stats bar */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">Total Indexed</p>
          <p className="text-xl font-bold text-[var(--text-primary)]">{stats.traderCount.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">With Scores</p>
          <p className="text-xl font-bold text-emerald-600">{allExperts.length.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">Last Sync</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {stats.lastSyncedAt ? new Date(stats.lastSyncedAt).toLocaleTimeString() : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">Data Source</p>
          <p className="text-sm font-semibold text-blue-600">Polymarket API</p>
        </div>
      </div>

      {/* Top Polymarket Wallets — Edge Score */}
      {pmTop10.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            Top Polymarket Wallets (Trust Score)
          </h2>
          <div className="space-y-2">
            {pmTop10.map((entry) => (
              <a
                key={entry.trader.proxyWallet}
                href={`/trader/${entry.trader.proxyWallet}`}
                className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:border-emerald-400"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                    #{entry.rank}
                  </span>
                  <div>
                    <span className="font-medium text-[var(--text-primary)]">
                      {entry.trader.displayName ??
                        entry.trader.pseudonym ??
                        `${entry.trader.proxyWallet.slice(0, 10)}…`}
                    </span>
                    {entry.trader.verifiedBadge && (
                      <span className="ml-2 text-[10px] text-blue-500 font-bold">✓ VERIFIED</span>
                    )}
                    <div className="flex gap-2 mt-0.5">
                      {entry.trader.categories?.slice(0, 3).map((cat) => (
                        <span key={cat} className="text-[9px] uppercase text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] rounded px-1">
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  <div className="text-center">
                    <p className="text-[var(--text-muted)]">Trust</p>
                    <p className="font-bold text-blue-600">{Number(entry.trader.trustScore).toFixed(0)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[var(--text-muted)]">Edge</p>
                    <p className="font-semibold text-emerald-600">{Number(entry.trader.edgeScore).toFixed(0)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[var(--text-muted)]">ROI</p>
                    <p className="font-semibold">{Number(entry.trader.roi).toFixed(0)}%</p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* All Experts Grid — from real polymarketTrader data */}
      <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
        Verified Experts ({allExperts.length})
      </h2>

      {allExperts.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[var(--text-secondary)]">
          Syncing experts from Polymarket… refresh in a few seconds.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allExperts.slice(0, 20).map((expert, index) => {
            const service = serviceRatings[index] || { avgRating: 0, reviewCount: 0 };
            const isVerified = expert.verifiedBadge;

            return (
              <Link
                key={expert.proxyWallet}
                href={`/trader/${expert.proxyWallet}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-blue-400"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-sm text-[var(--text-primary)]">
                        {expert.displayName ?? expert.pseudonym ?? `${expert.proxyWallet.slice(0, 8)}…`}
                      </p>
                      {isVerified && (
                        <span className="text-[9px] text-blue-500 font-bold">✓ VERIFIED</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/30 rounded px-2 py-1">
                    {Number(expert.trustScore).toFixed(0)}
                  </span>
                </div>

                {service.reviewCount > 0 && (
                  <div className="mb-2">
                    <StarRating rating={service.avgRating} size="sm" />
                    <span className="text-[10px] text-[var(--text-muted)] ml-1">({service.reviewCount})</span>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-[var(--text-muted)]">Trades</p>
                    <p className="font-semibold">{expert.totalTrades}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">Win %</p>
                    <p className="font-semibold">{Number(expert.winRate).toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">ROI</p>
                    <p className="font-semibold">{Number(expert.roi).toFixed(0)}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs mt-2 pt-2 border-t border-[var(--border)]">
                  <div>
                    <p className="text-[var(--text-muted)]">Edge</p>
                    <p className="font-semibold text-emerald-600">{Number(expert.edgeScore).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">PF</p>
                    <p className="font-semibold">{Number(expert.profitFactor).toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">Risk</p>
                    <p className="font-semibold">{expert.riskLevel}</p>
                  </div>
                </div>

                {expert.categories && expert.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {expert.categories.slice(0, 3).map((cat) => (
                      <span key={cat} className="text-[9px] uppercase bg-[var(--surface)] border border-[var(--border)] rounded px-1 text-[var(--text-muted)]">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
