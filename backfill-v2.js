const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

// Inline V2 reputation calculation (CJS-compatible)
function calcForecast(trades) {
  if (trades.length < 3) return { brierScore: 0.25, logLoss: 0.693, calibrationScore: 50, predictiveScore: 0 };
  const resolved = trades.filter(t => t.resolvedOutcome !== undefined);
  let brierSum = 0, brierCount = 0;
  for (const t of resolved) { brierSum += (t.price / 100 - t.resolvedOutcome) ** 2; brierCount++; }
  const brier = brierCount > 0 ? brierSum / brierCount : 0.25;
  let llSum = 0, llCount = 0;
  for (const t of resolved) {
    const prob = Math.max(0.001, Math.min(0.999, t.price / 100));
    llSum += -(t.resolvedOutcome * Math.log(prob) + (1 - t.resolvedOutcome) * Math.log(1 - prob));
    llCount++;
  }
  const logLoss = llCount > 0 ? llSum / llCount : 0.693;
  const brierNorm = Math.max(0, (0.25 - brier) / 0.25) * 100;
  const llNorm = Math.max(0, (0.693 - logLoss) / 0.693) * 100;
  return {
    brierScore: Math.round(brier * 1000) / 1000,
    logLoss: Math.round(logLoss * 1000) / 1000,
    calibrationScore: 50,
    predictiveScore: Math.round((brierNorm * 0.5 + llNorm * 0.5) * 10) / 10,
  };
}

function calcConfidence(trades, activeDays) {
  const n = trades.length;
  const mult = 1 - Math.exp(-n / 150);
  return {
    sampleSize: n,
    confidenceMultiplier: Math.round(mult * 1000) / 1000,
    confidenceScore: Math.round(mult * 100 * 10) / 10,
    avgTradesPerDay: activeDays > 0 ? Math.round((n / activeDays) * 10) / 10 : 0,
    activeWeeks: Math.max(1, Math.round((n / Math.max(1, activeDays)) * 7)),
  };
}

function calcBehavior(trades) {
  if (trades.length < 5) {
    return { revengeTradingScore: 50, fomoScore: 50, martingaleScore: 50, disciplineScore: 50, behaviorScore: 50 };
  }
  // Size discipline: coefficient of variation
  const sizes = trades.map(t => t.valueUsd || t.shares * t.price || 0);
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const std = Math.sqrt(sizes.reduce((s, v) => s + (v - avg) ** 2, 0) / sizes.length);
  const cv = avg > 0 ? std / avg : 0;
  const discipline = Math.max(0, Math.min(100, (1 - cv / 3) * 100));
  return {
    revengeTradingScore: 50,
    fomoScore: 50,
    martingaleScore: 50,
    disciplineScore: Math.round(discipline),
    behaviorScore: Math.round(discipline * 0.5 + 25),
  };
}

function calcRisk(trades) {
  if (trades.length < 5) {
    return { maxDrawdown: 0, volatility: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, exposureConcentration: 0, sectorConcentration: 0, riskScore: 50 };
  }
  const pnls = trades.map(t => {
    const val = t.valueUsd || t.shares * t.price || 0;
    if (t.resolvedOutcome === undefined) return 0;
    return t.resolvedOutcome === 1 ? val * (1 / Math.max(0.01, t.price / 100) - 1) : -val;
  });
  let peak = 0, maxDD = 0, cum = 0;
  for (const pnl of pnls) { cum += pnl; if (cum > peak) peak = cum; const dd = peak > 0 ? (peak - cum) / peak : 0; if (dd > maxDD) maxDD = dd; }
  const markets = {};
  let totalVol = 0;
  for (const t of trades) { const v = t.valueUsd || 0; markets[t.marketId] = (markets[t.marketId] || 0) + v; totalVol += v; }
  let hhi = 0; for (const v of Object.values(markets)) { const s = totalVol > 0 ? v / totalVol : 0; hhi += s * s; }
  const ddScore = Math.max(0, 100 - maxDD * 200);
  const expScore = Math.max(0, 100 - (hhi - 0.1) * 200);
  return {
    maxDrawdown: Math.round(maxDD * 10000) / 100,
    volatility: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    exposureConcentration: Math.round(hhi * 100),
    sectorConcentration: Math.round(hhi * 100),
    riskScore: Math.max(0, Math.min(100, Math.round(ddScore * 0.6 + expScore * 0.4))),
  };
}

function calcAlpha(trades) {
  if (trades.length < 3) return { alpha24h: 0, alpha7d: 0, sectorAlpha: 0, alphaScore: 0 };
  // Simplified: use entry price as proxy for alpha
  const prices = trades.map(t => t.price / 100);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  // If avg entry < 0.45, trader enters low (good alpha)
  const rawAlpha = 0.45 - avg;
  return {
    alpha24h: Math.round(rawAlpha * 1000) / 1000,
    alpha7d: 0,
    sectorAlpha: 0,
    alphaScore: Math.max(0, Math.min(100, Math.round(50 + rawAlpha * 400))),
  };
}

function calcPMI(forecast, alpha, confidence, behavior, risk) {
  return Math.round(Math.max(0, Math.min(100,
    forecast.predictiveScore * 0.30 +
    alpha.alphaScore * 0.25 +
    risk.riskScore * 0.20 +
    behavior.behaviorScore * 0.15 +
    confidence.confidenceScore * 0.10
  )) * 10) / 10;
}

async function main() {
  console.log('=== Reputation Engine V2 — Full Backfill ===\n');

  const traders = await p.polymarketTrader.findMany({
    orderBy: { edgeScore: 'desc' },
  });
  console.log(`Found ${traders.length} traders to process\n`);

  let processed = 0;
  let withV2 = 0;
  let totalTradesSaved = 0;
  const results = [];

  for (let i = 0; i < traders.length; i++) {
    const trader = traders[i];
    const idx = i + 1;

    try {
      // Fetch raw trades from Polymarket
      const POLY_DATA = 'https://data-api.polymarket.com';
      const POLY_GAMMA = 'https://gamma-api.polymarket.com';

      let allTrades = [];
      for (let page = 0; page < 10; page++) {
        try {
          const url = `${POLY_DATA}/trades?limit=100&offset=${page * 100}&user=${trader.proxyWallet}&order=timestamp&ascending=false`;
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) break;
          const batch = await r.json();
          if (!batch || !batch.length) break;
          allTrades = allTrades.concat(batch);
          if (batch.length < 100) break;
        } catch (e) {
          break; // rate limit or error, stop fetching
        }
      }

      // Save trades
      let tradesSaved = 0;
      if (allTrades.length > 0) {
        const tradeData = allTrades.map(t => ({
          traderId: trader.id,
          marketId: t.conditionId || t.marketId || `unk-${t.timestamp}`,
          conditionId: t.conditionId || '',
          marketTitle: t.title || null,
          category: trader.categories?.[0] || 'general',
          side: (t.side || 'BUY').toUpperCase(),
          outcome: t.outcomeIndex === 1 ? 'NO' : 'YES',
          price: t.price || 0,
          shares: t.size || 0,
          valueUsd: Math.round((t.price || 0) * (t.size || 0) * 100) / 100,
          feeUsd: null,
          entryProbability: t.price || null,
          timestamp: new Date(t.timestamp * 1000),
        }));

        for (let b = 0; b < tradeData.length; b += 100) {
          try {
            const res = await p.polymarketTrade.createMany({
              data: tradeData.slice(b, b + 100),
              skipDuplicates: true,
            });
            tradesSaved += res.count;
          } catch (e) { /* skip */ }
        }
      }

      // Compute V2 scores from trades
      let v2 = {
        predictiveScore: 0, alphaScore: 0, confidenceScore: 0,
        behaviorScore: 0, riskScore: 0, masterPMI: 0,
        forecastBrier: 0.25, forecastLogLoss: 0.693, forecastCalibration: 50,
        alpha24h: 0, alpha7d: 0, sectorAlpha: 0,
      };

      if (allTrades.length >= 5) {
        const repTrades = allTrades.map(t => ({
          id: `${t.timestamp}-${t.conditionId}`,
          traderId: trader.id,
          marketId: t.conditionId || 'unknown',
          conditionId: t.conditionId || '',
          category: trader.categories?.[0] || 'general',
          side: (t.side || 'BUY').toUpperCase(),
          outcome: t.outcomeIndex === 1 ? 'NO' : 'YES',
          price: t.price || 0,
          shares: t.size || 0,
          valueUsd: (t.price || 0) * (t.size || 0),
          timestamp: t.timestamp * 1000,
          resolvedOutcome: undefined,
        }));

        const forecast = calcForecast(repTrades);
        const alpha = calcAlpha(repTrades);
        const confidence = calcConfidence(repTrades, trader.activityDays || 1);
        const behavior = calcBehavior(repTrades);
        const risk = calcRisk(repTrades);
        const masterPMI = calcPMI(forecast, alpha, confidence, behavior, risk);

        v2 = {
          predictiveScore: forecast.predictiveScore,
          alphaScore: alpha.alphaScore,
          confidenceScore: confidence.confidenceScore,
          behaviorScore: behavior.behaviorScore,
          riskScore: risk.riskScore,
          masterPMI,
          forecastBrier: forecast.brierScore,
          forecastLogLoss: forecast.logLoss,
          forecastCalibration: forecast.calibrationScore,
          alpha24h: alpha.alpha24h,
          alpha7d: alpha.alpha7d,
          sectorAlpha: alpha.sectorAlpha,
        };

        // Update trader with V2 scores
        await p.polymarketTrader.update({
          where: { id: trader.id },
          data: v2,
        });

        withV2++;
      } else if (trader.totalTrades > 0) {
        // Trader has trades on record but we couldn't fetch them — mark with what we have
        const confidence = calcConfidence([], trader.activityDays || 1);
        await p.polymarketTrader.update({
          where: { id: trader.id },
          data: {
            confidenceScore: confidence.confidenceScore,
          },
        });
      }

      totalTradesSaved += tradesSaved;
      processed++;

      results.push({
        wallet: trader.proxyWallet.slice(0, 12) + '...',
        totalTrades: allTrades.length,
        tradesSaved,
        masterPMI: v2.masterPMI,
        predictive: v2.predictiveScore,
        alpha: v2.alphaScore,
        confidence: v2.confidenceScore,
        risk: v2.riskScore,
        behavior: v2.behaviorScore,
      });

      if (idx % 50 === 0 || idx === traders.length) {
        console.log(`[${idx}/${traders.length}] ${trader.proxyWallet.slice(0, 12)}... PMI=${v2.masterPMI} trades=${tradesSaved} totalSaved=${totalTradesSaved}`);
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      console.error(`[${idx}] Error ${trader.proxyWallet.slice(0, 12)}:`, err.message);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}/${traders.length}`);
  console.log(`Traders with V2 scores: ${withV2}`);
  console.log(`Total trades saved: ${totalTradesSaved}`);

  // Save results to JSON
  const fs = require('fs');
  fs.writeFileSync('v2-backfill-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to v2-backfill-results.json');

  // Top 10 by PMI
  const top10 = results.filter(r => r.masterPMI > 0).sort((a, b) => b.masterPMI - a.masterPMI).slice(0, 10);
  console.log('\n=== TOP 10 BY MASTER PMI ===');
  top10.forEach((r, i) => {
    console.log(`  #${i + 1} ${r.wallet} PMI=${r.masterPMI} Pred=${r.predictive} Alpha=${r.alpha} Risk=${r.risk} Behav=${r.behavior} Conf=${r.confidence}`);
  });
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); process.exit(1); });
