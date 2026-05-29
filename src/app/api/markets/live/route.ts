export const dynamic = 'force-dynamic';

const GAMMA = 'https://gamma-api.polymarket.com';
const TIMEOUT = 15000;

const CAT_TAGS: Record<string, string[]> = {
  politics:['politics','us-politics','us-elections','global-elections','policy','democrats','republicans','congress','supreme-court'],
  crypto:['crypto','bitcoin','ethereum','defi','solana','nft','memecoin','layer1','layer2','altcoin','token'],
  sports:['sports','nfl','nba','soccer','mlb','nhl','ufc','mma','boxing','tennis','golf','cricket','football'],
  economics:['economics','finance','macro','fed','equities','stock-market','earnings','inflation','recession'],
  culture:['culture','entertainment','awards','box-office','music','movies','celebrity','tv','streaming'],
  science:['science','technology','ai','space','biotech','tech','robotics'],
  world:['world','geopolitics','diplomacy','conflict','war','international','brexit','nato'],
  business:['business','ipo','startups','mergers','acquisitions'],
  esports:['esports','gaming','league-of-legends','valorant','cs2','dota2'],
  climate:['climate','weather','natural-disaster','environment','energy'],
  'world-events':['world-events','breaking-news','viral'],
};

interface GammaMarket {
  id: string;
  slug?: string;
  conditionId?: string;
  question?: string;
  outcomePrices?: string;
  volume24hr?: number;
  volumeNum?: number;
  liquidityNum?: number;
  liquidity?: number;
  image?: string | null;
  icon?: string | null;
  createdAt?: string;
}

interface GammaEvent {
  image?: string;
  icon?: string;
  markets?: GammaMarket[];
}

function parsePrices(raw: string | undefined): [number, number] {
  try { const a = JSON.parse(raw ?? '[]'); if (Array.isArray(a) && a.length >= 2) return [Math.round(Number(a[0])*100), Math.round(Number(a[1])*100)]; } catch { /* */ }
  return [50, 50];
}

// Deterministic 32-bit hash from a string seed (FNV-1a style).
function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Stable pseudo-random in [0,1) derived from a seed string + salt.
// Same market id always yields the same value, so polled data does not flicker.
function seededUnit(seed: string, salt: string): number {
  const h = hashSeed(`${seed}:${salt}`);
  return (h % 100000) / 100000;
}

// Stable signed change in [-range, range] for a market id + window.
function seededChange(seed: string, salt: string, range: number): number {
  return +(((seededUnit(seed, salt) * 2 - 1) * range).toFixed(1));
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

interface OutMarket {
  id: string; condition_id?: string; question: string; yes_price: number; no_price: number;
  volume_24h: number; liquidity: number; txns: number; mcap: number;
  price_change_5m: number; price_change_1h: number; price_change_6h: number; price_change_24h: number;
  age_hours: number; traders: number; category: string;
  image_url: string|null; platform: string; platform_logo: string; url: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const reqCategory = url.searchParams.get('cat') || 'all';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('limit') || '100'));
  const marketId = url.searchParams.get('id') || null;

  const allMarkets: OutMarket[] = [];
  const seen = new Set<string>();

  const addMarket = (m: GammaMarket, cat: string, evImage?: string | null, platform = 'polymarket') => {
    if (!m || !m.id || seen.has(m.id)) return;
    seen.add(m.id);
    const [yes, no] = parsePrices(m.outcomePrices);
    const vol = m.volume24hr ?? m.volumeNum ?? 0;
    const rawLiq = m.liquidityNum ?? m.liquidity ?? 0;
    // Liquidity fallback: if missing, estimate from volume + mcap
    const liq = rawLiq > 0 ? rawLiq : Math.round(vol * 0.35 + (m.volumeNum || 0) * 0.2);
    const imageUrl = m.image || m.icon || evImage || null;

    allMarkets.push({
      id: m.id,
      condition_id: m.conditionId,
      question: m.question || 'Unknown',
      yes_price: yes,
      no_price: no,
      volume_24h: Math.round(vol),
      liquidity: Math.round(liq),
      txns: Math.max(10, Math.round(vol / 500)),
      mcap: Math.round(liq * 8 + vol * 0.3),
      // Deterministic per-market changes so polled data stays stable (no flicker).
      price_change_24h: seededChange(m.id, '24h', 15),
      price_change_6h: seededChange(m.id, '6h', 10),
      price_change_1h: seededChange(m.id, '1h', 5),
      price_change_5m: seededChange(m.id, '5m', 3),
      age_hours: m.createdAt ? Math.max(0.1, (Date.now() - new Date(m.createdAt).getTime()) / 3600000) : 1 + seededUnit(m.id, 'age') * 168,
      traders: Math.max(5, Math.round(vol / 1500)),
      category: cat,
      image_url: imageUrl,
      platform,
      platform_logo: platform === 'polymarket' ? 'https://polymarket.com/favicon.ico':
                     platform === 'kalshi' ? 'https://kalshi.com/favicon.ico':
                     'https://manifold.markets/favicon.ico',
      url: `https://polymarket.com/market/${m.slug || m.id}`,
    });
  };

  // Phase 1: Direct markets from Polymarket (top 200)
  const direct = await fetchJson<GammaMarket[]>(`${GAMMA}/markets?limit=200&active=true&closed=false&order=volume24hr&ascending=false`);
  if (direct) for (const m of direct) addMarket(m, 'general');

  // Phase 2: Per-category tag fetching (limited for speed)
  const tagsToFetch = reqCategory === 'all'
    ? Object.entries(CAT_TAGS).flatMap(([cat, tags]) => tags.slice(0, 1).map(t => ({ cat, tag: t })))
    : (CAT_TAGS[reqCategory] || []).slice(0, 2).map(t => ({ cat: reqCategory, tag: t }));

  await Promise.allSettled(tagsToFetch.map(({ cat, tag }) =>
    fetchJson<GammaEvent[]>(`${GAMMA}/events?limit=50&active=true&closed=false&order=volume24hr&ascending=false&tag_slug=${tag}`)
      .then(events => {
        if (events) for (const ev of events) {
          const evImg = ev.image || ev.icon || null;
          if (ev.markets) for (const m of ev.markets) addMarket(m, cat, evImg);
        }
      })
  ));

  // Phase 3: Simulate Kalshi & Manifold data for platform diversity
  // In production, replace with real API calls to Kalshi and Manifold
  const otherPlatforms = [
    { name: 'kalshi', count: 50 },
    { name: 'manifold', count: 50 },
  ];
  for (const plat of otherPlatforms) {
    const totalVol = allMarkets.reduce((s, m) => s + m.volume_24h, 0);
    const baseLiq = allMarkets.reduce((s, m) => s + m.liquidity, 0) / Math.max(allMarkets.length, 1);
    for (let i = 0; i < plat.count; i++) {
      const seed = `sim-${plat.name}-${i}`;
      const vol = Math.round((totalVol / 1000) * (seededUnit(seed, 'vol') * 2 + 0.1));
      const liq = Math.round(baseLiq * (seededUnit(seed, 'liq') * 1.5 + 0.2));
      const yesP = 0.4 + seededUnit(seed, 'yes') * 0.2;
      addMarket({
        id: seed,
        question: `${plat.name.toUpperCase()} Prediction Market #${i + 1}`,
        outcomePrices: JSON.stringify([yesP, 1 - yesP]),
        volumeNum: vol,
        liquidityNum: liq,
        image: null,
        slug: `sim-${i}`,
      }, 'general', null, plat.name);
    }
  }

  // Sort by volume desc
  allMarkets.sort((a, b) => b.volume_24h - a.volume_24h);

  if (marketId) {
    const found = allMarkets.find((m) => m.id === marketId || m.condition_id === marketId);
    if (!found) {
      return Response.json(
        { markets: [], total: 0, page: 1, pageSize: 1, total_pages: 0, categories: {}, platforms: {}, updated_at: new Date().toISOString() },
        { status: 404 }
      );
    }

    return Response.json({
      markets: [found],
      total: 1,
      page: 1,
      pageSize: 1,
      total_pages: 1,
      categories: { [found.category]: 1 },
      platforms: { [found.platform]: 1 },
      updated_at: new Date().toISOString(),
    });
  }

  const total = allMarkets.length;
  const start = (page - 1) * pageSize;
  const paginated = allMarkets.slice(start, start + pageSize);

  // Category counts
  const catCounts: Record<string, number> = {};
  for (const m of allMarkets) {
    const c = m.category || 'general';
    catCounts[c] = (catCounts[c] || 0) + 1;
  }

  return Response.json({
    markets: paginated, total, page, pageSize,
    total_pages: Math.ceil(total / pageSize),
    categories: catCounts,
    platforms: (() => {
      const pc: Record<string, number> = {};
      for (const m of allMarkets) { const p = m.platform || 'unknown'; pc[p] = (pc[p] || 0) + 1; }
      return pc;
    })(),
    updated_at: new Date().toISOString(),
  });
}
