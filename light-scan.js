/**
 * LIGHTWEIGHT MASS DISCOVERY
 * Sequential requests with delay to avoid rate limits
 * Go backwards in time to discover EVERY wallet
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const DATA = 'https://data-api.polymarket.com';
const PAGE_SIZE = 100;
const DELAY = 500; // ms between requests

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetch(url) {
  try {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(id);
    if (r.status === 429) { await sleep(5000); return null; }
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function main() {
  const existing = new Set(
    (await p.polymarketTrader.findMany({ select: { proxyWallet: true } })).map(t => t.proxyWallet)
  );
  console.log(`Starting: ${existing.size} traders already in DB`);
  
  const allWallets = new Set(existing);
  const now = Math.floor(Date.now() / 1000);
  const oneDay = 24 * 3600;
  
  // Go back 7 days in 6-hour chunks
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour += 6) {
      const end = now - day * oneDay - hour * 3600;
      const start = end - 6 * 3600;
      
      // Fetch trades in this window
      for (let page = 0; page < 50; page++) {
        const url = `${DATA}/trades?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&timestamp_gt=${start}&timestamp_lt=${end}&order=timestamp&ascending=false`;
        const data = await fetch(url);
        if (!data || data.length === 0) break;
        
        for (const t of data) {
          if (t.proxyWallet?.startsWith('0x')) {
            allWallets.add(t.proxyWallet.toLowerCase());
          }
        }
        await sleep(DELAY);
      }
      
      const newFound = allWallets.size - existing.size;
      console.log(`Day ${day}h${hour}: ${allWallets.size} total wallets (+${newFound} new)`);
    }
  }
  
  const newWallets = [...allWallets].filter(w => !existing.has(w));
  console.log(`\nDiscovery complete: ${newWallets.size} new wallets`);
  
  // Sync new wallets
  let synced = 0, totalTrades = 0;
  for (const wallet of newWallets) {
    try {
      const trades = [];
      for (let page = 0; page < 50; page++) {
        const data = await fetch(`${DATA}/trades?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&user=${wallet}&order=timestamp&ascending=false`);
        if (!data || data.length === 0) break;
        trades.push(...data);
        await sleep(200);
      }
      
      if (trades.length === 0) continue;
      
      const trader = await p.polymarketTrader.upsert({
        where: { proxyWallet: wallet },
        update: { lastSyncedAt: new Date() },
        create: { proxyWallet: wallet, lastSyncedAt: new Date() },
      });
      
      let saved = 0;
      const tradeData = trades.map(t => ({
        traderId: trader.id,
        marketId: t.conditionId || `unk-${t.timestamp}`,
        conditionId: t.conditionId || '',
        marketTitle: t.title || null,
        category: 'general',
        side: (t.side || 'BUY').toUpperCase(),
        outcome: t.outcomeIndex === 1 ? 'NO' : 'YES',
        price: t.price || 0,
        shares: t.size || 0,
        valueUsd: (t.price || 0) * (t.size || 0),
        entryProbability: t.price || null,
        timestamp: new Date(t.timestamp * 1000),
      }));
      
      for (let b = 0; b < tradeData.length; b += 100) {
        try {
          const res = await p.polymarketTrade.createMany({ data: tradeData.slice(b, b + 100), skipDuplicates: true });
          saved += res.count;
        } catch {}
      }
      
      synced++;
      totalTrades += saved;
      
      if (synced % 10 === 0) console.log(`Synced: ${synced}/${newWallets.length} | Trades: ${totalTrades}`);
      
      await sleep(DELAY);
    } catch (e) { /* skip */ }
  }
  
  const [finalTraders, finalTrades] = await Promise.all([
    p.polymarketTrader.count(),
    p.polymarketTrade.count(),
  ]);
  
  console.log(`\nDone! Traders: ${finalTraders} | Trades: ${finalTrades}`);
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
