export const dynamic = 'force-dynamic';

const DATA = 'https://data-api.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';
const TIMEOUT = 12000;

interface RawTrade {
  proxyWallet: string;
  side: string;
  price: number;
  size: number;
  timestamp: number;
  outcomeIndex: number;
  conditionId: string;
  transactionHash?: string;
  title?: string;
  slug?: string;
}

interface GammaMarket {
  id: string;
  slug?: string;
  conditionId?: string;
}

interface OutTrade {
  id: string;
  wallet: string;
  side: string;
  outcome: string;
  price: number;
  size: number;
  total_value: number;
  timestamp: number;
  time_ago: string;
  market?: string;
}

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 0) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), TIMEOUT);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(id);
    return r.ok ? await r.json() as T : null;
  } catch { return null; }
}

async function resolveConditionId(marketId: string | null): Promise<string | null> {
  if (!marketId) return null;
  const markets = await fetchJson<GammaMarket[]>(`${GAMMA}/markets?limit=500&active=true&closed=false&order=volume24hr&ascending=false`);
  const found = markets?.find((m) => m.id === marketId || m.slug === marketId || m.conditionId === marketId);
  return found?.conditionId ?? marketId;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const marketId = url.searchParams.get('marketId') ?? url.searchParams.get('conditionId');
  const conditionId = await resolveConditionId(marketId);
  const all: OutTrade[] = [];
  const seen = new Set<string>();

  const add = (t: RawTrade) => {
    const key = t.transactionHash || `${t.proxyWallet}-${t.timestamp}-${t.outcomeIndex}-${Math.random()}`;
    if (seen.has(key)) return;
    seen.add(key);
    all.push({
      id: key,
      wallet: t.proxyWallet,
      side: t.side?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      outcome: t.outcomeIndex === 1 ? 'NO' : 'YES',
      price: t.price,
      size: t.size,
      total_value: Math.round(t.price * t.size * 100) / 100,
      timestamp: t.timestamp,
      time_ago: ago(t.timestamp),
      market: t.title || t.slug || 'Polymarket Event',
    });
  };

  if (conditionId) {
    const recent = await fetchJson<RawTrade[]>(`${DATA}/trades?limit=200&condition_id=${encodeURIComponent(conditionId)}&takerOnly=false&order=timestamp&ascending=false`);
    if (recent) recent.forEach(add);

    const whales = await fetchJson<RawTrade[]>(`${DATA}/trades?limit=100&condition_id=${encodeURIComponent(conditionId)}&takerOnly=false&order=size&ascending=false&minSize=500`);
    if (whales) whales.forEach(add);
  } else {
    const globalTrades = await fetchJson<RawTrade[]>(`${DATA}/trades?limit=200&takerOnly=false&order=timestamp&ascending=false`);
    if (globalTrades) globalTrades.forEach(add);

    const whaleTrades = await fetchJson<RawTrade[]>(`${DATA}/trades?limit=100&takerOnly=false&order=size&ascending=false&minSize=500`);
    if (whaleTrades) whaleTrades.forEach(add);
  }

  // Fetch 3: Get some condition IDs from active markets to fetch specific trades
  const markets = await fetchJson<Array<{ conditionId: string; question: string }>>(
    `${GAMMA}/markets?limit=20&active=true&closed=false&order=volume24hr&ascending=false`
  );
  if (!conditionId && markets) {
    for (const m of markets.slice(0, 5)) {
      if (!m.conditionId) continue;
      const t = await fetchJson<RawTrade[]>(`${DATA}/trades?limit=50&condition_id=${m.conditionId}&order=timestamp&ascending=false`);
      if (t) t.forEach(tr => add({ ...tr, conditionId: m.conditionId }));
    }
  }

  all.sort((a, b) => b.timestamp - a.timestamp);

  return Response.json({ trades: all.slice(0, 200) });
}
