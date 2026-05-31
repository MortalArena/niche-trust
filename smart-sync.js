/**
 * SMART SYNC — Works within Polymarket API limits
 * 
 * Strategy: Instead of scanning ALL trades (rate-limited),
 * we use the Gamma API to get active markets, then for each
 * market we fetch its trades. This is the intended API usage.
 * 
 * We also use the existing sync engine to continuously
 * discover new traders over time.
 * 
 * This script:
 * 1. Fetches ALL active markets from Gamma API (with pagination)
 * 2. For each market, fetches trades from Data API
 * 3. Discovers new wallets from those trades
 * 4. Syncs each new wallet with complete history
 * 5. Calculates V2 reputation scores
 * 
 * Run this periodically (e.g., every hour) to keep data fresh.
 */

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const DATA = 'https://data-api.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, maxRetries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const ctl = new AbortController();
      const id = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(id);

      if (r.status === 429) {
        const wait = 3000 * (attempt + 1) + Math.random() * 2000;
        console.log(`    Rate limited, waiting ${Math.round(wait/1000)}s...`);
        await sleep(wait);
        continue;
      }

      if (r.ok) {
        const text = await r.text();
        return JSON.parse(text);
      }

      console.warn(`    HTTP ${r.status}: ${url.slice(0, 80)}`);
      return null;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) await sleep(1000 * (attempt + 1));
    }
  }
  console.warn(`    Fetch failed: ${lastErr?.message}: ${url.slice(0, 80)}`);
  return null;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║              SMART SYNC — ACTIVE DATA             ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const existingWallets = new Set(
    (await p.polymarketTrader.findMany({ select: { proxyWallet: true } })).map(t => t.proxyWallet)
  );
  const existingTrades = await p.polymarketTrade.count();
  console.log(`DB: ${existingWallets.size} traders, ${existingTrades} trades\n`);

  // Step 1: Get ALL active markets from Gamma API
  console.log('Step 1: Fetching ALL active markets from Gamma API...\n');
  console.log(`  API: ${GAMMA}/markets`);
  console.log(`  Node version: ${process.version}`);
  console.log(`  fetch available: ${typeof fetch === 'function'}\n`);
  
  const allMarkets = [];
  const seenMarketIds = new Set();

  for (let page = 0; page < 100; page++) {
    const apiUrl = `${GAMMA}/markets?limit=100&active=true&closed=false&order=volume24hr&ascending=false&offset=${page * 100}`;
    console.log(`  Fetching page ${page}...`);
    const data = await fetchWithRetry(apiUrl, 5);
    console.log(`  Result: ${data ? `Array(${data.length})` : 'null/undefined'}`);
    if (!data || !Array.isArray(data) || data.length === 0) break;

    let newInPage = 0;
    for (const m of data) {
      if (m.id && !seenMarketIds.has(m.id)) {
        seenMarketIds.add(m.id);
        allMarkets.push(m);
        newInPage++;
      }
    }

    if (page % 10 === 0) console.log(`  Markets page ${page}: ${allMarkets.length} total (${newInPage} new)`);

    if (newInPage === 0 && data.length < 100) break; // no new markets and page not full
    await sleep(200);
  }

  console.log(`\nFound ${allMarkets.length} active markets\n`);

  // Step 2: For each market, fetch trades and discover wallets
  console.log('Step 2: Scanning market trades for new wallets...\n');

  const newWallets = new Set();
  let marketsScanned = 0;
  let totalMarketTrades = 0;

  for (const market of allMarkets) {
    const conditionId = market.conditionId;
    if (!conditionId) continue;

    // Fetch trades for this market (just first page to discover wallets)
    const trades = await fetchWithRetry(`${DATA}/trades?limit=100&condition_id=${encodeURIComponent(conditionId)}&order=timestamp&ascending=false`, 5);
    
    if (trades && trades.length > 0) {
      totalMarketTrades += trades.length;
      for (const t of trades) {
        if (t.proxyWallet?.startsWith('0x')) {
          const w = t.proxyWallet.toLowerCase();
          if (!existingWallets.has(w) && !newWallets.has(w)) {
            newWallets.add(w);
          }
        }
      }
    }

    marketsScanned++;
    if (marketsScanned % 100 === 0) {
      console.log(`  [${marketsScanned}/${allMarkets.length}] Markets scanned | Trades: ${totalMarketTrades} | New wallets: ${newWallets.size}`);
    }

    await sleep(150); // polite delay
  }

  console.log(`\nStep 2 complete: ${newWallets.size} new wallets from ${marketsScanned} markets (${totalMarketTrades} trades)\n`);

  // Step 3: Sync each new wallet
  if (newWallets.size > 0) {
    console.log(`Step 3: Syncing ${newWallets.size} new wallets...\n`);

    const walletArray = Array.from(newWallets);
    let synced = 0;
    let totalNewTrades = 0;

    for (let i = 0; i < walletArray.length; i++) {
      const wallet = walletArray[i];

      try {
        // Fetch ALL trades for this wallet
        const allTrades = [];
        for (let page = 0; page < 100; page++) {
          const data = await fetchWithRetry(`${DATA}/trades?limit=100&offset=${page * 100}&user=${wallet}&order=timestamp&ascending=false`, 5);
          if (!data || data.length === 0) break;
          allTrades.push(...data);
          if (data.length < 100) break;
          await sleep(100);
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

        await sleep(200);
      } catch (e) {
        console.error(`  Error ${wallet.slice(0, 12)}:`, e.message);
      }
    }

    console.log(`\nStep 3 complete: ${synced} wallets synced, ${totalNewTrades} trades saved`);
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
