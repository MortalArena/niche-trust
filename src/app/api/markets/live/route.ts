import { NextRequest, NextResponse } from 'next/server';
import { fetchAllActiveMarkets } from '@/lib/polymarket/full-fetcher';

export const dynamic = 'force-dynamic';

interface OutMarket {
  id: string; question: string; yes_price: number; no_price: number;
  volume_24h: number; liquidity: number; txns: number; mcap: number;
  price_change_5m: number; price_change_1h: number; price_change_6h: number; price_change_24h: number;
  age_hours: number; traders: number; category: string;
  image_url: string|null; platform: string; url: string;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const reqCategory = url.searchParams.get('cat') || 'all';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(500, parseInt(url.searchParams.get('limit') || '200'));
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const marketId = url.searchParams.get('id') || null;
    const maxPages = parseInt(url.searchParams.get('maxPages') || '50');

    // If specific market requested
    if (marketId) {
      const all = await fetchAllActiveMarkets(undefined, 100);
      const found = all.find(m => m.id === marketId || m.slug === marketId);
      if (found) {
        return NextResponse.json({
          markets: [found], total: 1, page: 1, pageSize: 1,
          total_pages: 1, categories: {}, platforms: { polymarket: 1 },
          updated_at: new Date().toISOString(),
        });
      }
      return NextResponse.json(
        { markets: [], total: 0, page: 1, pageSize, total_pages: 0, categories: {}, platforms: {}, updated_at: new Date().toISOString() },
        { status: 404 }
      );
    }

    // Fetch ALL markets
    console.log(`[Live API] Fetching markets: cat=${reqCategory}, maxPages=${maxPages}`);
    const allMarkets = await fetchAllActiveMarkets(
      reqCategory !== 'all' ? reqCategory : undefined,
      maxPages
    );
    console.log(`[Live API] Fetched ${allMarkets.length} markets`);

    // Apply search filter
    let filtered = allMarkets;
    if (search) {
      filtered = allMarkets.filter((m) =>
        m.question.toLowerCase().includes(search) ||
        m.category.toLowerCase().includes(search) ||
        m.id.toLowerCase().includes(search)
      );
    }

    // Sort by volume desc
    filtered.sort((a, b) => b.volume_24h - a.volume_24h);

    // Paginate
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Category counts
    const catCounts: Record<string, number> = {};
    for (const m of allMarkets) {
      const c = m.category || 'general';
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    return NextResponse.json({
      markets: paginated,
      total,
      page,
      pageSize,
      total_pages: totalPages,
      categories: catCounts,
      platforms: { polymarket: allMarkets.length },
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Live API error:', error);
    return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 500 });
  }
}
