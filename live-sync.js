const { PrismaClient } = require('@prisma/client');
const https = require('https');
const http = require('http');
const p = new PrismaClient();

var isRunning = false;
var lastDiscovery = 0;

function fetchJSON(url) {
  return new Promise(function(resolve) {
    var mod = url.startsWith('https') ? https : http;
    var req = mod.get(url, { headers: { 'Accept': 'application/json' }, timeout: 20000 }, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() { try { resolve({ s: res.statusCode, d: JSON.parse(d) }); } catch(e) { resolve({ s: res.statusCode, d: null }); } });
    });
    req.on('error', function() { resolve({ s: 0, d: null }); });
    req.on('timeout', function() { req.destroy(); resolve({ s: 0, d: null }); });
  });
}

async function getTrades(addr, limit, offset) {
  try { var r = await fetchJSON('https://data-api.polymarket.com/trades?user=' + addr + '&limit=' + limit + '&offset=' + offset + '&takerOnly=false'); return r.d || []; } catch { return []; }
}
async function getClosed(addr) { try { var r = await fetchJSON('https://data-api.polymarket.com/closed-positions?user=' + addr + '&limit=200'); return r.d || []; } catch { return []; }
}
async function getProfile(addr) { try { var r = await fetchJSON('https://gamma-api.polymarket.com/public-profile?address=' + addr); return (r && r.d) ? r.d : null; } catch { return null; }
}

function calcPnL(trades, closed) {
  var posQ = {}, rpnl = 0, vol = 0, w = 0, l = 0, gp = 0, gl = 0, cats = new Set();
  if (closed) for (var i = 0; i < closed.length; i++) { var rp = Number(closed[i].realizedPnl || 0); if (rp !== 0) { rpnl += rp; if (rp > 0) { w++; gp += rp; } else { l++; gl += Math.abs(rp); } } }
  var records = [];
  for (var i = 0; i < trades.length; i++) {
    var t = trades[i], sz = Number(t.size), pr = Number(t.price), not = sz * pr;
    vol += not; var asset = t.asset || t.conditionId;
    var title = (t.title || '').toLowerCase();
    if (title.match(/election|trump|biden|politic|vote/)) cats.add('politics');
    else if (title.match(/btc|bitcoin|eth|crypto|solana|defi/)) cats.add('crypto');
    else if (title.match(/nfl|nba|soccer|sport|game|match/)) cats.add('sports');
    else if (title.match(/fed|rate|inflation|gdp|stock|econom/)) cats.add('economics');
    else if (title.match(/movie|music|award|oscar|entertainment/)) cats.add('culture');
    else if (title.match(/ai|tech|space|science|biotech/)) cats.add('science-tech');
    else cats.add('general');
    if (t.side === 'BUY') {
      if (!posQ[asset]) posQ[asset] = [];
      posQ[asset].push({ size: sz, price: pr });
      records.push({ pnl: 0, ep: pr, xp: pr, sz: sz, et: t.timestamp, xt: t.timestamp });
    } else {
      var q = posQ[asset] || []; var rem = sz, pnl = 0;
      while (rem > 0.001 && q.length > 0) { var m = Math.min(rem, q[0].size); pnl += m * (pr - q[0].price); q[0].size -= m; rem -= m; if (q[0].size < 0.001) q.shift(); }
      if (pnl > 0) { w++; gp += pnl; } else if (pnl < 0) { l++; gl += Math.abs(pnl); }
      rpnl += pnl;
      records.push({ pnl: pnl, ep: q.length > 0 ? q[0].price : pr, xp: pr, sz: sz, et: t.timestamp - 3600, xt: t.timestamp });
    }
  }
  return { records, vol, rpnl, w, l, gp, gl, cats: Array.from(cats) };
}

function calcScores(recs, vol, rpnl, w, l, gp, gl, days, tr) {
  var roi = vol > 0 ? (rpnl / vol) * 100 : 0;
  var wr = (w + l) > 0 ? (w / (w + l)) * 100 : 0;
  var pf = gl === 0 ? (gp > 0 ? 5 : 1) : gp / gl;
  var cons = Math.min(100, Math.max(0, 50 + (wr - 50) * 0.5 + (roi > 0 ? roi * 0.3 : roi * 0.1)));
  var rN = Math.min(100, Math.max(0, ((roi + 50) / 200) * 100));
  var wN = Math.min(100, wr);
  var ddN = Math.min(100, Math.max(0, 100 - Math.abs(Math.min(0, roi)) * 2));
  var pfN = Math.min(100, Math.max(0, (pf / 5) * 100));
  var sC = tr >= 50 ? 100 : tr >= 20 ? 75 : tr >= 10 ? 55 : tr >= 5 ? 35 : 15;
  var trust = rN * 0.20 + wN * 0.20 + cons * 0.15 + ddN * 0.15 + pfN * 0.10 + sC * 0.20;
  if (tr < 5) trust *= 0.6; trust = Math.min(100, Math.max(0, trust));
  var risk = Math.abs(roi) < 15 && cons > 60 && pf > 1.2 && wr > 55 ? 'LOW' : (Math.abs(roi) > 50 || (pf < 0.8 && tr > 10) || (wr < 35 && tr > 10)) ? 'HIGH' : 'MEDIUM';
  var edge = Math.min(100, rN * 0.30 + cons * 0.25 + wN * 0.15 + ddN * 0.10 + 50 * 0.10 + pfN * 0.10);
  var master = (wr * 0.50) + (Math.min(roi, 200) * 0.30) + (Math.min(tr, 500) * 0.20);
  return { trustScore: Math.round(trust * 100) / 100, edgeScore: Math.round(edge * 100) / 100, masterScore: Math.round(master * 100) / 100, roi: Math.round(roi * 100) / 100, winRate: Math.round(wr * 100) / 100, consistency: Math.round(cons * 100) / 100, profitFactor: Math.round(pf * 100) / 100, maxDrawdown: Math.round(Math.abs(Math.min(0, roi)) * 100) / 100, riskLevel: risk };
}

async function syncTrader(trader) {
  var addr = trader.proxyWallet;
  var all = [];
  for (var pg = 0; pg < 5; pg++) { var b = await getTrades(addr, 100, pg * 100); if (!b || !b.length) break; all = all.concat(b); if (b.length < 100) break; }
  var closed = await getClosed(addr);
  var profile = await getProfile(addr);
  if (!all.length && (!closed || !closed.length)) { await p.polymarketTrader.update({ where: { proxyWallet: addr }, data: { lastSyncedAt: new Date() } }); return { synced: false }; }
  var pnl = calcPnL(all, closed);
  var days = new Set(all.map(function(t) { return new Date((t.timestamp > 1e12 ? t.timestamp : t.timestamp * 1000)).toISOString().substring(0, 10); })).size;
  var scores = calcScores(pnl.records, pnl.vol, pnl.rpnl, pnl.w, pnl.l, pnl.gp, pnl.gl, days, pnl.records.length);
  var equityCurve = []; var run = 0; for (var i = 0; i < pnl.records.length; i++) { run += pnl.records[i].pnl; equityCurve.push(Math.round(run * 100) / 100); }
  var hourlyDist = Array.from({ length: 24 }, function(_, h) { return all.filter(function(t) { return new Date((t.timestamp > 1e12 ? t.timestamp : t.timestamp * 1000)).getUTCHours() === h; }).length; });
  await p.polymarketTrader.upsert({
    where: { proxyWallet: addr },
    update: Object.assign({ lastSyncedAt: new Date(), lastLiveData: { equityCurve: equityCurve.slice(-100), hourlyDistribution: hourlyDist, lastTradeAt: all.length > 0 ? all[0].timestamp : null } }, scores),
    create: Object.assign({ proxyWallet: addr, lastSyncedAt: new Date(), lastLiveData: { equityCurve: equityCurve.slice(-100), hourlyDistribution: hourlyDist } }, scores),
  });
  return Object.assign({ synced: true, addr: addr, trades: pnl.records.length }, scores);
}

async function discoverNew() {
  try {
    var r = await fetchJSON('https://data-api.polymarket.com/trades?limit=100&offset=0&takerOnly=false');
    if (!r.d || !r.d.length) return 0;
    var wallets = new Set(r.d.map(function(t) { return (t.proxyWallet || '').toLowerCase(); }).filter(function(w) { return w && w.startsWith('0x') && w.length === 42; }));
    var imported = 0;
    var arr = Array.from(wallets);
    for (var i = 0; i < Math.min(arr.length, 30); i++) {
      try { await p.polymarketTrader.create({ data: { proxyWallet: arr[i], lastSyncedAt: new Date(0), categories: ['general'] } }); imported++; } catch(e) {}
    }
    return imported;
  } catch(e) { return 0; }
}

async function runSync() {
  if (isRunning) return;
  isRunning = true;
  try {
    var now = Date.now();
    if (now - lastDiscovery > 5 * 60 * 1000) { var disc = await discoverNew(); if (disc > 0) console.log('[DISCOVER] +' + disc + ' new wallets'); lastDiscovery = now; }
    var stale = await p.polymarketTrader.findMany({ where: { OR: [{ totalTrades: 0 }, { lastSyncedAt: { lt: new Date(now - 20 * 60 * 1000) } }] }, take: 5, orderBy: { lastSyncedAt: 'asc' } });
    if (stale.length === 0) { isRunning = false; return; }
    for (var i = 0; i < stale.length; i++) {
      var r = await syncTrader(stale[i]);
      if (r.synced) console.log('[SYNC] ' + r.addr.substring(0, 8) + '... trust:' + r.trustScore + ' edge:' + r.edgeScore + ' trades:' + r.trades + ' roi:' + r.roi + '%');
      await new Promise(function(res) { setTimeout(res, 500); });
    }
  } catch(e) { console.error('[SYNC ERROR]', e.message); }
  isRunning = false;
}

console.log('[LIVE SYNC ENGINE] Starting...');
console.log('  - Discovers new wallets every 5 min');
console.log('  - Syncs stale traders every 20 min');
console.log('  - Refreshes on page visit');
setInterval(runSync, 60000);
runSync();
