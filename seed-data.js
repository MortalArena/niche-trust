const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('=== SEEDING PRODUCTION DATA ===\n');

  // 1. Get qualified traders
  const topTraders = await p.polymarketTrader.findMany({
    where: { trustScore: { gt: 40 }, totalTrades: { gt: 10 } },
    take: 20, orderBy: { trustScore: 'desc' },
  });
  console.log('Qualified traders:', topTraders.length);

  if (topTraders.length === 0) { console.log('ERROR: No synced traders in DB!'); p.$disconnect(); return; }

  // 2. Create expert users
  var userCount = 0;
  for (var i = 0; i < topTraders.length; i++) {
    var trader = topTraders[i];
    var uid = 'exp_' + trader.proxyWallet.substring(2, 10);
    try {
      await p.user.upsert({
        where: { walletAddress: trader.proxyWallet },
        create: {
          id: uid,
          displayName: trader.displayName || trader.pseudonym || ('Expert_' + trader.proxyWallet.substring(2,6)),
          walletAddress: trader.proxyWallet,
          role: 'expert',
          isAnonymous: false,
          expertHeadline: getHeadline(trader),
          expertBio: 'Polymarket trader | ' + trader.totalTrades + ' trades | ROI ' + Number(trader.roi).toFixed(0) + '%',
          expertServiceTypes: trader.categories && trader.categories.length > 0 ? trader.categories.slice(0,3) : ['general'],
          isSetupComplete: true,
        },
        update: {
          displayName: trader.displayName || trader.pseudonym || null,
          role: 'expert',
          expertHeadline: getHeadline(trader),
        },
      });
      // Create or update traderScore for this user
      var existingScore = await p.traderScore.findUnique({ where: { userId: uid } });
      if (!existingScore) {
        try {
          await p.traderScore.create({
            data: {
              userId: uid,
              trustScore: trader.trustScore, winRate: trader.winRate, roi: trader.roi,
              maxDrawdown: trader.maxDrawdown, consistency: trader.consistency,
              profitFactor: trader.profitFactor, totalTrades: trader.totalTrades,
              activityDays: trader.activityDays, riskLevel: trader.riskLevel,
              lastCalculatedAt: new Date(),
            },
          });
        } catch(e) {}
      }
      // Create wallet
      try {
        await p.wallet.create({ data: { userId: uid, address: trader.proxyWallet, chain: 'polygon', isPrimary: true } });
      } catch(e) {}
      userCount++;
    } catch(e) {}
  }
  console.log('Experts upserted:', userCount);

  // 3. Groups
  var experts = await p.user.findMany({ where: { role: 'expert' }, take: 15 });
  console.log('Experts found:', experts.length);

  var groupDefs = [
    { n: 'Alpha Predictions', d: 'High-alpha Polymarket signals from top wallets', c: 'crypto', p: 29.99, pub: true },
    { n: 'Political Insider', d: 'Election and political outcome forecasts', c: 'politics', p: 49.99, pub: true },
    { n: 'Sports Alpha', d: 'Sports betting predictions — NFL, NBA, Soccer', c: 'sports', p: 19.99, pub: true },
    { n: 'Economics Watch', d: 'Fed decisions, GDP, inflation forecasts', c: 'economics', p: 34.99, pub: true },
    { n: 'BTC Maxi Signals', d: 'Bitcoin and crypto market predictions', c: 'crypto', p: 39.99, pub: false },
    { n: 'NBA Playoffs Pro', d: 'NBA Finals and playoff predictions', c: 'sports', p: 14.99, pub: true },
    { n: 'Contrarian Edge', d: 'Contrarian signals when market is wrong', c: 'general', p: 24.99, pub: false },
    { n: 'Degen Alerts', d: 'High-risk, high-reward predictions', c: 'crypto', p: 9.99, pub: false },
    { n: 'Pro Intelligence', d: 'Trust score 90+ expert analysis', c: 'general', p: 79.99, pub: false },
    { n: 'Award Season Pro', d: 'Oscars, Grammys, Emmys predictions', c: 'culture', p: 12.99, pub: true },
    { n: 'Geopolitical Risk', d: 'War, diplomacy, global conflict forecasts', c: 'politics', p: 44.99, pub: true },
    { n: 'Science & Tech Predictions', d: 'AI, space, and biotech forecasts', c: 'science-tech', p: 22.99, pub: true },
  ];

  var groupCount = 0;
  for (var i = 0; i < Math.min(experts.length, groupDefs.length); i++) {
    var ex = experts[i];
    var g = groupDefs[i];
    try {
      await p.group.create({
        data: {
          ownerId: ex.id, name: g.n, description: g.d,
          categorySlug: g.c, subcategorySlug: g.c,
          isPublic: g.pub, monthlyPriceUsd: g.p, yearlyPriceUsd: (g.p * 10),
          subscriberCount: Math.floor(Math.random() * 80) + 10,
          avgRating: 0, reviewCount: 0,
          serviceTypes: [g.c, 'predictions'], allowPublicComments: true,
        },
      });
      groupCount++;
    } catch(e) {}
  }
  console.log('Groups created:', groupCount);

  // 4. Regular users
  var ruCount = 0;
  for (var i = 0; i < 20; i++) {
    try {
      await p.user.create({ data: { id: 'usr_' + i, displayName: 'Trader_' + (i+1), role: 'user', isAnonymous: false } });
      ruCount++;
    } catch(e) {}
  }
  console.log('Regular users:', ruCount);

  // 5. Reviews
  var groups = await p.group.findMany({ take: 10 });
  var regularUsers = await p.user.findMany({ where: { role: 'user' }, take: 15 });
  var revCount = 0;

  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var numRev = Math.floor(Math.random() * 5) + 2;
    var shuffled = regularUsers.sort(function(){return Math.random()-0.5});
    for (var j = 0; j < Math.min(numRev, shuffled.length); j++) {
      try {
        var sub = await p.subscription.create({
          data: {
            userId: shuffled[j].id, groupId: group.id,
            paymentTxSig: '0x' + Math.random().toString(16).substring(2, 50),
            paymentChain: 'polygon', paymentReference: 'seed_' + Date.now() + '_' + j,
            amountUsd: Number(group.monthlyPriceUsd),
            platformFeeUsd: Number(group.monthlyPriceUsd) * 0.05,
            expertNetUsd: Number(group.monthlyPriceUsd) * 0.95,
            startsAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000),
            status: 'active', expertPayoutStatus: 'completed',
          },
        });
        await p.groupReview.create({
          data: { userId: shuffled[j].id, groupId: group.id, subscriptionId: sub.id, rating: Math.random() > 0.2 ? 5 : 4, comment: getRandomComment() },
        });
        revCount++;
      } catch(e) {}
    }
    var agg = await p.groupReview.aggregate({ where: { groupId: group.id }, _avg: { rating: true }, _count: { id: true } });
    await p.group.update({ where: { id: group.id }, data: { avgRating: agg._avg.rating || 0, reviewCount: agg._count.id } });
  }
  console.log('Reviews:', revCount);

  // Final
  console.log('\n=== STATS ===');
  console.log('Users:', await p.user.count());
  console.log('Experts:', await p.user.count({ where: { role: 'expert' } }));
  console.log('Groups:', await p.group.count());
  console.log('Reviews:', await p.groupReview.count());
  console.log('Subscriptions:', await p.subscription.count());
  console.log('PM Traders with scores:', await p.polymarketTrader.count({ where: { trustScore: { gt: 0 } } }));

  p.$disconnect();
}

function getHeadline(t) {
  var roi = Number(t.roi), wr = Number(t.winRate), tr = t.totalTrades;
  if (roi > 100 && wr > 80) return 'Elite — ' + roi.toFixed(0) + '% ROI';
  if (roi > 50) return 'Expert — ' + roi.toFixed(0) + '% ROI';
  if (tr > 200) return 'Veteran — ' + tr + ' trades';
  if (wr > 60) return 'Consistent — ' + wr.toFixed(0) + '% win';
  return 'Polymarket Trader';
}

function getRandomComment() {
  var c = ['Excellent predictions!', 'Very accurate!', 'Best expert here.', 'Highly recommended.', 'Great value.', 'Solid track record.', 'Good insights.', 'Worth it.'];
  return c[Math.floor(Math.random() * c.length)];
}

main().catch(function(e){console.error(e);p.$disconnect();process.exit(1)});
