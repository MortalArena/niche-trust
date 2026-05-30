const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('=== EXPERTS DATA AUDIT ===\n');

  // 1. traderScore table (used by experts page)
  const traderScoreCount = await p.traderScore.count();
  const traderScoreWithData = await p.traderScore.count({ where: { trustScore: { gt: 0 } } });
  console.log('traderScore table:');
  console.log('  Total rows:', traderScoreCount);
  console.log('  With trustScore > 0:', traderScoreWithData);

  // 2. polymarketTrader table (used by leaderboard)
  const pmCount = await p.polymarketTrader.count();
  const pmWithScores = await p.polymarketTrader.count({ where: { trustScore: { gt: 0 } } });
  console.log('\npolymarketTrader table:');
  console.log('  Total rows:', pmCount);
  console.log('  With trustScore > 0:', pmWithScores);

  // 3. Users table
  const userCount = await p.user.count();
  const experts = await p.user.count({ where: { role: 'expert' } });
  console.log('\nUsers table:');
  console.log('  Total users:', userCount);
  console.log('  Experts:', experts);

  // 4. Groups table
  const groupCount = await p.group.count();
  const publicGroups = await p.group.count({ where: { isPublic: true } });
  const privateGroups = await p.group.count({ where: { isPublic: false } });
  console.log('\nGroups table:');
  console.log('  Total groups:', groupCount);
  console.log('  Public:', publicGroups);
  console.log('  Private:', privateGroups);

  // 5. Reviews table
  const reviewCount = await p.groupReview.count();
  console.log('\nReviews:', reviewCount);

  // 6. Subscriptions table
  const subCount = await p.subscription.count();
  console.log('Subscriptions:', subCount);

  // 7. Top traderScore entries
  console.log('\n=== TOP 10 traderScore (Experts page source) ===');
  const topScores = await p.traderScore.findMany({
    take: 10,
    orderBy: { trustScore: 'desc' },
    include: { user: { select: { displayName: true, walletAddress: true, isAnonymous: true } } }
  });
  if (topScores.length === 0) {
    console.log('  (EMPTY - no data!)');
  }
  topScores.forEach(function(t, i) {
    console.log('#' + (i+1) + ' userId:' + t.userId + ' trust:' + Number(t.trustScore) + ' winRate:' + Number(t.winRate) + ' roi:' + Number(t.roi) + ' trades:' + t.totalTrades + ' name:' + (t.user?.displayName || t.user?.walletAddress?.substring(0,8) || 'anon'));
  });

  // 8. Top polymarketTrader entries
  console.log('\n=== TOP 10 polymarketTrader (Leaderboard source) ===');
  const topPM = await p.polymarketTrader.findMany({
    take: 10,
    orderBy: { trustScore: 'desc' },
  });
  topPM.forEach(function(t, i) {
    console.log('#' + (i+1) + ' ' + t.proxyWallet.substring(0,8) + '... trust:' + Number(t.trustScore) + ' edge:' + Number(t.edgeScore) + ' trades:' + t.totalTrades + ' roi:' + Number(t.roi) + '% win:' + Number(t.winRate) + '% name:' + (t.displayName || t.pseudonym || 'anon'));
  });

  // 9. Compare: are the top experts in traderScore also in polymarketTrader?
  console.log('\n=== COMPARISON ===');
  if (topScores.length > 0 && topPM.length > 0) {
    const expertUserIds = topScores.map(function(t) { return t.userId; });
    const pmWallets = topPM.map(function(t) { return t.proxyWallet; });
    console.log('Experts page uses: traderScore table (userId-based)');
    console.log('Leaderboard uses: polymarketTrader table (wallet-based)');
    console.log('These are DISCONNECTED data sources!');
    console.log('traderScore has', traderScoreCount, 'rows, polymarketTrader has', pmCount, 'rows');
  }

  p.$disconnect();
}

main().catch(function(e) { console.error(e); p.$disconnect(); });
