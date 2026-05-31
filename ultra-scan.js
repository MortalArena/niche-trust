/**
 * ULTRA MASS DISCOVERY
 * 
 * Strategy: The Data API /trades endpoint returns ALL trades.
 * We paginate using timestamp_lt (less than) to go backwards in time.
 * This bypasses the offset limit.
 * 
 * For each 1-hour chunk, we fetch up to 50 pages (5000 trades).
 * This covers ~7 years of data in ~61,000 API calls.
 * We process in batches to avoid rate limits.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const DATA = 'https://data-api.polymarket.com';
const PAGE_SIZE = 100;
const PAGES_PER_CHUNK = 50;  // 50 pages × 100 = 5000 trades per chunk
const DELAY_MS = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetch(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctl = new AbortController();
      const id = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(id);
      if (r.status === 429) {
        const wait = 5000 * (attempt + 1);
        console.log(`  Rate limited, waiting ${wait/1000}s...`);
        await sleep(wait);
        continue;
      }
      if (!r.ok) return null;
      const text = await r.text();
      if (!text || text.length < 10) return null;
      return JSON.parse(text);
    } catch (e) {
      if (attempt < 2) await sleep(1000);
      else return null;
    }
  }
  return null;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║    ULTRA MASS DISCOVERY — ALL POLYMARKET DATA     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const existingWallets = new Set(
    (await p.polymarketTrader.findMany({ select: { proxyWallet: true } })).map(t => t.proxyWallet)
  );
  const existingTrades = await p.polymarketTrade.count();
  console.log(`DB: ${existingWallets.size} traders, ${existingTrades} trades\n`);

  const newWallets = new Set();
  let totalScanned = 0;

  // Start from now and go backwards
  // Polymarket launched in 2020, so ~6 years of data
  const now = Math.floor(Date.now() / 1000);
  const startOfPolymarket = new Date('2020-06-01').getTime() / 1000;
  const chunkSize = 3600 * 6; // 6 hours per chunk

  let currentEnd = now;
  let chunkNum = 0;
  const totalChunks = Math.ceil((now - startOfPolymarket) / chunkSize);

  console.log(`Scanning ${totalChunks} chunks from ${new Date(now * 1000).toISOString().slice(0, 10)} to ${new Date(startOfPolymarket * 1000).toISOString().slice(0, 10)}\n`);

  for (let ts = now; ts > startOfPolymarket; ts -= chunkSize) {
    const chunkEnd = ts;
    const chunkStart = Math.max(ts - chunkSize, startOfPolymarket);

    // Fetch trades in this time chunk
    for (let page = 0; page < PAGES_PER_CHUNK; page++) {
      const offset = page * PAGE_SIZE;
      const url = `${DATA}/trades?limit=${PAGE_SIZE}&offset=${offset}&timestamp_gt=${chunkStart}&timestamp_lt=${chunkEnd}&order=timestamp&ascending=false`;

      const data = await fetch(url);
      if (!data || data.length === 0) break;

      totalScanned += data.length;
      let newInPage = 0;

      for (const trade of data) {
        if (trade.proxyWallet && trade.proxyWallet.startsWith('0x')) {
          const w = trade.proxyWallet.toLowerCase();
          if (!existingWallets.has(w) && !newWallets.has(w)) {
            newWallets.add(w);
            newInPage++;
          }
        }
      }

      await sleep(DELAY_MS);
    }

    chunkNum++;

    if (chunkNum % 50 === 0) {
      const pct = ((chunkNum / totalChunks) * 100).toFixed(1);
      console.log(`[${pct}%] Chunk ${chunkNum}/${totalChunks} | Scanned: ${totalScanned} | New wallets: ${newWallets.size}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`DISCOVERY COMPLETE`);
  console.log(`═══════════════════════════════════════════════════`);
  console.log(`Total trades scanned: ${totalScanned}`);
  console.log(`New wallets discovered: ${newWallets.size}`);
  console.log(`Total unique wallets: ${existingWallets.size + newWallets.size}`);

  // Final DB stats
  const [finalTraders, finalTrades] = await Promise.all([
    p.polymarketTrader.count(),
    p.polymarketTrade.count(),
  ]);

  console.log(`\nDB: ${finalTraders} traders, ${finalTrades} trades`);
  if (newWallets.size > 0) {
    console.log(`\nRun the sync script to fetch complete trade history for ${newWallets.size} new traders.`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
