/**
 * PRACTICAL MASS DISCOVERY
 * 
 * Phase 1: Scan last 30 days of trades (most active traders)
 * Phase 2: For each new wallet, fetch COMPLETE history
 * 
 * This discovers the vast majority of active traders
 * without hitting API limits.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const DATA = 'https://data-api.polymarket.com';
const PAGE_SIZE = 100;
const DELAY_MS = 200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetch(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ctl = new AbortController();
      const id = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(id);
      if (r.status === 429) {
        const wait = 3000 * (attempt + 1) + Math.random() * 2000;
        await sleep(wait);
        continue;
      }
      if (!r.ok) return null;
      const text = await r.text();
      if (!text || text.length < 10) return null;
      return JSON.parse(text);
    } catch (e) {
      if (attempt < 4) await sleep(1000 * (attempt + 1));
      else return null;
    }
  }
  return null;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       PRACTICAL MASS DISCOVERY — 30 DAYS          ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const existingWallets = new Set(
    (await p.polymarketTrader.findMany({ select: { proxyWallet: true } })).map(t => t.proxyWallet)
  );
  const existingTrades = await p.polymarketTrade.count();
  console.log(`DB: ${existingWallets.size} traders, ${existingTrades} trades\n`);

  const newWallets = new Set();
  let totalScanned = 0;

  // Scan last 30 days in 2-hour chunks
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 24 * 3600;
  const chunkSize = 3600 * 2; // 2 hours

  let chunkNum = 0;
  const totalChunks = Math.ceil((now - thirtyDaysAgo) / chunkSize);

  console.log(`Scanning ${totalChunks} chunks (2h each) over 30 days...\n`);

  for (let ts = now; ts > thirtyDaysAgo; ts -= chunkSize) {
    const chunkEnd = ts;
    const chunkStart = Math.max(ts - chunkSize, thirtyDaysAgo);

    for (let page = 0; page < 50; page++) {
      const url = `${DATA}/trades?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&timestamp_gt=${chunkStart}&timestamp_lt=${chunkEnd}&order=timestamp&ascending=false`;
      const data = await fetch(url);
      if (!data || data.length === 0) break;

      totalScanned += data.length;

      for (const trade of data) {
        if (trade.proxyWallet && trade.proxyWallet.startsWith('0x')) {
          const w = trade.proxyWallet.toLowerCase();
          if (!existingWallets.has(w) && !newWallets.has(w)) {
            newWallets.add(w);
          }
        }
      }

      await sleep(DELAY_MS);
    }

    chunkNum++;
    if (chunkNum % 20 === 0) {
      const pct = ((chunkNum / totalChunks) * 100).toFixed(1);
      console.log(`[${pct}%] ${chunkNum}/${totalChunks} chunks | Scanned: ${totalScanned} | New: ${newWallets.size}`);
    }
  }

  console.log(`\nPhase 1 complete: ${newWallets.size} new wallets from ${totalScanned} trades`);

  // Phase 2: Sync each new wallet with complete history
  if (newWallets.size > 0) {
    console.log(`\nPhase 2: Syncing ${newWallets.size} new wallets...\n`);

    const walletArray = Array.from(newWallets);
    let synced = 0;
    let totalNewTrades = 0;

    for (let i = 0; i < walletArray.length; i++) {
      const wallet = walletArray[i];

      try {
        // Fetch ALL trades for this wallet
        const allTrades = [];
        for (let page = 0; page < 100; page++) {
          const data = await fetch(`${DATA}/trades?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&user=${wallet}&order=timestamp&ascending=false`);
          if (!data || data.length === 0) break;
          allTrades.push(...data);
          if (data.length < PAGE_SIZE) break;
          await sleep(150);
        }

        if (allTrades.length === 0) continue;

        // Determine categories
        const cats = new Set();
        for (const t of allTrades) {
          const title = (t.title || '').toLowerCase();
          if (title.match(/election|trump|biden|politic|vote|democrat|republican|government|policy/)) cats.add('politics');
          else if (title.match(/btc|bitcoin|eth|crypto|solana|defi|nft|web3|token|coin/)) cats.add('crypto');
          else if (title.match(/nfl|nba|soccer|football|sport|game|match|playoff|final|ufc|mma/)) cats.add('sports');
          else if (title.match(/fed|rate|inflation|gdp|stock|market|econom|recession|macro/)) cats.add('economics');
          else if (title.match(/movie|music|award|oscar|grammy|entertainment|celebrity|film/)) cats.add('culture');
          else if (title.match(/war|geopolit|conflict|russia|ukraine|china|diplomacy|israel|iran/)) cats.add('politics');
          else if (title.match(/ai|tech|space|nasa|science|biotech|innovation|research/)) cats.add('science');
          else if (title.match(/ipo|startup|merger|earning|business|corporate|company/)) cats.add('business');
        }
        const categories = cats.size > 0 ? Array.from(cats) : ['general'];

        // Upsert trader
        const trader = await p.polymarketTrader.upsert({
          where: { proxyWallet: wallet },
          update: { categories, lastSyncedAt: new Date() },
          create: { proxyWallet: wallet, categories, lastSyncedAt: new Date() },
        });

        // Save trades
        let saved = 0;
        const tradeData = allTrades.map(t => ({
          traderId: trader.id,
          marketId: t.conditionId || `unk-${t.timestamp}`,
          conditionId: t.conditionId || '',
          marketTitle: t.title || null,
          category: categories[0] || 'general',
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
            const res = await p.polymarketTrade.createMany({ data: tradeData.slice(b, b + 100), skipDuplicates: true });
            saved += res.count;
          } catch {}
        }

        // Update stats
        const wins = allTrades.filter(t => t.outcomeIndex === 0).length;
        await p.polymarketTrader.update({
          where: { proxyWallet: wallet },
          data: { totalTrades: allTrades.length, winRate: allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0 },
        });

        synced++;
        totalNewTrades += saved;

        if (synced % 10 === 0) {
          console.log(`  [${synced}/${walletArray.length}] Synced | Trades: ${totalNewTrades}`);
        }

        await sleep(DELAY_MS);
      } catch (e) {
        console.error(`  Error ${wallet.slice(0, 12)}:`, e.message);
      }
    }

    console.log(`\nPhase 2 complete: ${synced} wallets synced, ${totalNewTrades} trades saved`);
  }

  // Final stats
  const [finalTraders, finalTrades, v2Count] = await Promise.all([
    p.polymarketTrader.count(),
    p.polymarketTrade.count(),
    p.polymarketTrader.count({ where: { masterPMI: { gt: 0 } } }),
  ]);

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`FINAL DB STATE`);
  console.log(`═══════════════════════════════════════════════════`);
  console.log(`Traders: ${finalTraders}`);
  console.log(`Trades: ${finalTrades}`);
  console.log(`V2 Scored: ${v2Count}`);
  console.log(`New wallets this run: ${newWallets.size}`);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
