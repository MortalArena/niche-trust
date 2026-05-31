import { POLYMARKET as POLYMARKET_SITE } from '@/lib/polymarket/config';
import { getTradesForUser, getClosedPositionsForUser } from '@/lib/polymarket/data';
import { resolvePolymarketProfile } from '@/lib/polymarket/profiles';
import { tradesFromPolymarket } from '@/lib/polymarket/trade-metrics';
import { calculateTrustScore } from '@/lib/analytics/trustscore';
import { calculateEdgeScore } from '@/lib/intelligence/edge-score';
import { buildMonthlyReturns } from '@/lib/analytics/trades-from-txs';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Prisma } from '@prisma/client';
import { ensureSyncEngine } from '@/instrument';
import { calculateReputation } from '@/lib/reputation';

// Start the continuous sync engine on first import
ensureSyncEngine();

export interface PolymarketTraderBrief {
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
  polymarketUrl: string;
  lastSyncedAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  trader: PolymarketTraderBrief;
}

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categories: string[];
}

function mergeCategories(existing: string[], next: string): string[] {
  return [...new Set([...existing, next])];
}

/**
 * Sync a single Polymarket wallet: fetch live data → compute scores → DB cache.
 * Fetches up to 1000 trades (10 pages × 100) for accurate scoring.
 */
export async function syncPolymarketTrader(
  proxyWallet: string,
  categories: string[] = []
): Promise<PolymarketTraderBrief | null> {
  try {
    const profile = await resolvePolymarketProfile(proxyWallet);
    const queryAddress = (profile?.proxyWallet ?? proxyWallet).toLowerCase();

    // Fetch trades in pages to get full history
    let allTrades: Awaited<ReturnType<typeof getTradesForUser>> = [];
    let offset = 0;
    const pageSize = 100;
    const maxPages = 10;

    for (let page = 0; page < maxPages; page++) {
      const batch = await getTradesForUser(queryAddress, pageSize, offset);
      if (!batch.length) break;
      allTrades = allTrades.concat(batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    const closed = await getClosedPositionsForUser(queryAddress, 200).catch(() => []);

    if (!allTrades.length && !closed.length) return null;

    const { tradeRecords, totalVolumeUsd, avgTradeSize, timingScore } = tradesFromPolymarket(
      allTrades,
      closed
    );

    const activityDays = new Set(
      allTrades.map((t) => new Date(t.timestamp * 1000).toDateString())
    ).size;

    const equityCurve = tradeRecords.reduce<number[]>((curve, tr) => {
      const prev = curve.length ? curve[curve.length - 1]! : 0;
      curve.push(prev + tr.pnl);
      return curve;
    }, []);

    const monthlyReturns = buildMonthlyReturns(tradeRecords);
    const tradesPerMonth = tradeRecords.length / Math.max(1, activityDays / 30);

    const result = calculateTrustScore({
      trades: tradeRecords,
      monthlyReturns,
      equityCurve,
      tradeCount: tradeRecords.length,
      activityDays: Math.max(activityDays, 1),
    });

    const edgeScore = calculateEdgeScore({
      roi: result.roi,
      consistency: result.consistency,
      maxDrawdown: result.maxDrawdown,
      timingScore,
      tradesPerMonth,
      winRate: result.winRate,
      profitFactor: result.profitFactor,
    });

    const existing = await prisma.polymarketTrader.findUnique({
      where: { proxyWallet: queryAddress },
      select: { categories: true, id: true },
    });

    const mergedCategoriesList = categories.reduce(
      (acc, cat) => mergeCategories(acc, cat),
      existing?.categories ?? []
    );

    const polymarketUrl = `${POLYMARKET_SITE}/profile/${queryAddress}`;

    // ── Save raw trades to PolymarketTrade table ──
    const traderId = existing?.id;
    if (traderId && allTrades.length > 0) {
      const tradeData = allTrades.map((t: any) => ({
        traderId,
        marketId: t.conditionId || t.marketId || `unknown-${t.timestamp}`,
        conditionId: t.conditionId || '',
        marketTitle: t.title || t.market || null,
        category: t.category || mergedCategoriesList[0] || 'general',
        side: (t.side || 'BUY').toUpperCase(),
        outcome: t.outcomeIndex === 1 ? 'NO' : 'YES',
        price: t.price || 0,
        shares: t.size || 0,
        valueUsd: Math.round((t.price || 0) * (t.size || 0) * 100) / 100,
        feeUsd: null,
        entryProbability: t.price || null,
        timestamp: new Date(t.timestamp * 1000),
      }));

      // Batch insert, skip duplicates
      for (let i = 0; i < tradeData.length; i += 100) {
        const batch = tradeData.slice(i, i + 100);
        await prisma.polymarketTrade.createMany({
          data: batch as any,
          skipDuplicates: true,
        }).catch(() => {}); // ignore duplicate errors
      }
    }

    // ── Compute V2 Reputation Scores ──
    let v2Scores = {
      predictiveScore: 0, alphaScore: 0, confidenceScore: 0,
      behaviorScore: 0, riskScore: 0, masterPMI: 0,
      forecastBrier: 0.25, forecastLogLoss: 0.693, forecastCalibration: 50,
      alpha24h: 0, alpha7d: 0, sectorAlpha: 0,
    };

    if (traderId && allTrades.length >= 5) {
      try {
        const savedTrades = await prisma.polymarketTrade.findMany({
          where: { traderId },
          orderBy: { timestamp: 'asc' },
        });

        const repTrades = savedTrades.map((t: any) => ({
          id: t.id,
          traderId: t.traderId,
          marketId: t.marketId,
          conditionId: t.conditionId,
          marketTitle: t.marketTitle || undefined,
          category: t.category || undefined,
          side: t.side,
          outcome: t.outcome,
          price: Number(t.price),
          shares: Number(t.shares),
          valueUsd: Number(t.valueUsd),
          entryProbability: t.entryProbability ? Number(t.entryProbability) : undefined,
          timestamp: t.timestamp.getTime(),
        }));

        const marketSnapshots = new Map<string, { probability: number; timestamp: number }[]>();
        const repPositions: any[] = [];

        const reputation = calculateReputation(
          repTrades,
          repPositions,
          marketSnapshots,
          Math.max(activityDays, 1)
        );

        v2Scores = {
          predictiveScore: reputation.predictiveScore,
          alphaScore: reputation.alphaScore,
          confidenceScore: reputation.confidenceScore,
          behaviorScore: reputation.behaviorScore,
          riskScore: reputation.riskScore,
          masterPMI: reputation.masterPMI,
          forecastBrier: reputation.forecastMetrics.brierScore,
          forecastLogLoss: reputation.forecastMetrics.logLoss,
          forecastCalibration: reputation.forecastMetrics.calibrationScore,
          alpha24h: reputation.alphaMetrics.alpha24h,
          alpha7d: reputation.alphaMetrics.alpha7d,
          sectorAlpha: reputation.alphaMetrics.sectorAlpha,
        };
      } catch (v2Err) {
        logger.warn({ proxyWallet, v2Err }, 'V2 reputation calculation failed, using defaults');
      }
    }

    const brief: PolymarketTraderBrief = {
      proxyWallet: queryAddress,
      displayName: profile?.name ?? null,
      pseudonym: profile?.pseudonym ?? null,
      verifiedBadge: profile?.verifiedBadge ?? false,
      xUsername: profile?.xUsername ?? null,
      trustScore: result.trustScore,
      edgeScore,
      winRate: result.winRate,
      roi: result.roi,
      maxDrawdown: result.maxDrawdown,
      consistency: result.consistency,
      profitFactor: result.profitFactor,
      riskLevel: result.riskLevel,
      totalTrades: tradeRecords.length,
      activityDays,
      avgTradeSize,
      totalVolumeUsd,
      timingScore,
      categories: mergedCategoriesList,
      polymarketUrl,
      lastSyncedAt: new Date().toISOString(),
    };

    await prisma.polymarketTrader.upsert({
      where: { proxyWallet: queryAddress },
      update: {
        ...brief,
        lastSyncedAt: new Date(),
        predictiveScore: v2Scores.predictiveScore,
        alphaScore: v2Scores.alphaScore,
        confidenceScore: v2Scores.confidenceScore,
        behaviorScore: v2Scores.behaviorScore,
        riskScore: v2Scores.riskScore,
        masterPMI: v2Scores.masterPMI,
        forecastBrier: v2Scores.forecastBrier,
        forecastLogLoss: v2Scores.forecastLogLoss,
        forecastCalibration: v2Scores.forecastCalibration,
        alpha24h: v2Scores.alpha24h,
        alpha7d: v2Scores.alpha7d,
        sectorAlpha: v2Scores.sectorAlpha,
      },
      create: {
        proxyWallet: queryAddress,
        displayName: brief.displayName,
        pseudonym: brief.pseudonym,
        verifiedBadge: brief.verifiedBadge ?? false,
        xUsername: brief.xUsername,
        trustScore: brief.trustScore,
        edgeScore: brief.edgeScore,
        winRate: brief.winRate,
        roi: brief.roi,
        maxDrawdown: brief.maxDrawdown,
        consistency: brief.consistency,
        profitFactor: brief.profitFactor,
        riskLevel: brief.riskLevel,
        totalTrades: brief.totalTrades,
        activityDays: brief.activityDays,
        avgTradeSize: brief.avgTradeSize,
        totalVolumeUsd: brief.totalVolumeUsd,
        timingScore: brief.timingScore,
        categories: mergedCategoriesList,
        lastSyncedAt: new Date(),
        predictiveScore: v2Scores.predictiveScore,
        alphaScore: v2Scores.alphaScore,
        confidenceScore: v2Scores.confidenceScore,
        behaviorScore: v2Scores.behaviorScore,
        riskScore: v2Scores.riskScore,
        masterPMI: v2Scores.masterPMI,
        forecastBrier: v2Scores.forecastBrier,
        forecastLogLoss: v2Scores.forecastLogLoss,
        forecastCalibration: v2Scores.forecastCalibration,
        alpha24h: v2Scores.alpha24h,
        alpha7d: v2Scores.alpha7d,
        sectorAlpha: v2Scores.sectorAlpha,
      },
    });

    return brief;
  } catch (error) {
    logger.error({ proxyWallet, error }, 'Failed to sync Polymarket trader');
    return null;
  }
}

/**
 * Get leaderboard from REAL database only. No mock data fallback.
 */
export async function getLeaderboard(options?: {
  categories?: string[];
  search?: string;
  minTrades?: number;
  limit?: number;
  page?: number;
  sortBy?:
    | 'edgeScore' | 'trustScore' | 'roi' | 'winRate'
    | 'consistency' | 'totalVolumeUsd' | 'totalTrades'
    | 'profitFactor' | 'maxDrawdown';
}): Promise<LeaderboardPage> {
  const {
    categories,
    search,
    minTrades = 0,
    limit = 50,
    page = 1,
    sortBy = 'edgeScore',
  } = options ?? {};

  const skip = (page - 1) * limit;

  const where: Prisma.PolymarketTraderWhereInput = {};

  if (categories && categories.length === 1) {
    where.categories = { has: categories[0] };
  } else if (categories && categories.length > 1) {
    where.categories = { hasSome: categories };
  }

  if (minTrades > 0) {
    where.totalTrades = { gte: minTrades };
  }

  if (search && search.trim().length > 0) {
    const q = search.trim();
    where.OR = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { pseudonym: { contains: q, mode: 'insensitive' } },
      { xUsername: { contains: q, mode: 'insensitive' } },
      { proxyWallet: { contains: q, mode: 'insensitive' } },
    ];
  }

  const validSortFields = [
    'edgeScore', 'trustScore', 'roi', 'winRate', 'consistency',
    'totalVolumeUsd', 'totalTrades', 'profitFactor', 'maxDrawdown',
    'masterPMI', 'predictiveScore', 'alphaScore', 'confidenceScore',
    'behaviorScore', 'riskScore',
  ];
  const validSortKey = validSortFields.includes(sortBy) ? sortBy : 'edgeScore';
  const orderBy: Record<string, 'asc' | 'desc'> = { [validSortKey]: 'desc' };

  const [total, traders] = await Promise.all([
    prisma.polymarketTrader.count({ where }),
    prisma.polymarketTrader.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true, proxyWallet: true, displayName: true, pseudonym: true,
        verifiedBadge: true, xUsername: true, trustScore: true, edgeScore: true,
        winRate: true, roi: true, maxDrawdown: true, consistency: true,
        profitFactor: true, riskLevel: true, totalTrades: true, activityDays: true,
        avgTradeSize: true, totalVolumeUsd: true, timingScore: true, categories: true,
        lastSyncedAt: true,
        predictiveScore: true, alphaScore: true, confidenceScore: true,
        behaviorScore: true, riskScore: true, masterPMI: true,
        forecastBrier: true, forecastLogLoss: true, forecastCalibration: true,
        alpha24h: true, alpha7d: true, sectorAlpha: true,
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const resultCategories = new Set<string>();
  for (const t of traders) {
    for (const c of t.categories) resultCategories.add(c);
  }

  const polymarketBase = POLYMARKET_SITE;

  const entries: LeaderboardEntry[] = traders.map((t, i) => ({
    rank: skip + i + 1,
    trader: {
      proxyWallet: t.proxyWallet,
      displayName: t.displayName,
      pseudonym: t.pseudonym,
      verifiedBadge: t.verifiedBadge,
      xUsername: t.xUsername,
      trustScore: Number(t.trustScore),
      edgeScore: Number(t.edgeScore),
      winRate: Number(t.winRate),
      roi: Number(t.roi),
      maxDrawdown: Number(t.maxDrawdown),
      consistency: Number(t.consistency),
      profitFactor: Number(t.profitFactor),
      riskLevel: t.riskLevel,
      totalTrades: t.totalTrades,
      activityDays: t.activityDays,
      avgTradeSize: Number(t.avgTradeSize),
      totalVolumeUsd: Number(t.totalVolumeUsd),
      timingScore: Number(t.timingScore),
      categories: t.categories,
      polymarketUrl: `${polymarketBase}/profile/${t.proxyWallet}`,
      lastSyncedAt: t.lastSyncedAt.toISOString(),
    },
    // V2 scores attached to each entry
    v2: {
      predictiveScore: Number(t.predictiveScore) || 0,
      alphaScore: Number(t.alphaScore) || 0,
      confidenceScore: Number(t.confidenceScore) || 0,
      behaviorScore: Number(t.behaviorScore) || 0,
      riskScore: Number(t.riskScore) || 0,
      masterPMI: Number(t.masterPMI) || 0,
    },
  }));

  return {
    entries,
    total,
    page,
    pageSize: limit,
    totalPages,
    categories: Array.from(resultCategories).sort(),
  };
}

export async function getIntelligenceStats() {
  const [traderCount, lastSync] = await Promise.all([
    prisma.polymarketTrader.count(),
    prisma.polymarketTrader.findFirst({
      orderBy: { lastSyncedAt: 'desc' },
      select: { lastSyncedAt: true },
    }),
  ]);

  return {
    traderCount,
    lastSyncedAt: lastSync?.lastSyncedAt?.toISOString() ?? null,
  };
}

export async function getCategoryCounts(): Promise<Record<string, number>> {
  const allTraders = await prisma.polymarketTrader.findMany({
    select: { categories: true },
    take: 100000,
  });

  const counts: Record<string, number> = {};
  for (const t of allTraders) {
    for (const c of t.categories) {
      counts[c] = (counts[c] ?? 0) + 1;
    }
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([, a], [, b]) => b - a)
  );
}
