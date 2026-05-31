const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const p = new PrismaClient();

async function main() {
  console.log('Exporting full database backup...');

  const data = {};

  console.log('Exporting users...');
  data.users = await p.user.findMany();
  console.log(`  ${data.users.length} users`);

  console.log('Exporting wallets...');
  data.wallets = await p.wallet.findMany();
  console.log(`  ${data.wallets.length} wallets`);

  console.log('Exporting polymarket traders...');
  data.polymarketTraders = await p.polymarketTrader.findMany({
    orderBy: { masterPMI: 'desc' },
  });
  console.log(`  ${data.polymarketTraders.length} traders`);

  const withV2 = data.polymarketTraders.filter(t => t.masterPMI > 0).length;
  console.log(`  ${withV2} with V2 reputation scores`);
  const withTrades = data.polymarketTraders.filter(t => Number(t.totalTrades) > 0).length;
  console.log(`  ${withTrades} with trade data`);

  console.log('Exporting polymarket trades...');
  data.polymarketTrades = await p.polymarketTrade.findMany();
  console.log(`  ${data.polymarketTrades.length} trades`);

  console.log('Exporting polymarket positions...');
  data.polymarketPositions = await p.polymarketPosition.findMany();
  console.log(`  ${data.polymarketPositions.length} positions`);

  console.log('Exporting predictions...');
  data.predictions = await p.prediction.findMany();
  console.log(`  ${data.predictions.length} predictions`);

  console.log('Exporting groups...');
  data.groups = await p.group.findMany();
  console.log(`  ${data.groups.length} groups`);

  console.log('Exporting group reviews...');
  data.groupReviews = await p.groupReview.findMany();
  console.log(`  ${data.groupReviews.length} reviews`);

  console.log('Exporting subscriptions...');
  data.subscriptions = await p.subscription.findMany();
  console.log(`  ${data.subscriptions.length} subscriptions`);

  console.log('Exporting intelligence rankings...');
  data.intelligenceRankings = await p.intelligenceRanking.findMany();
  console.log(`  ${data.intelligenceRankings.length} rankings`);

  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync('db-backup-full.json', json);
  console.log(`\nDone! db-backup-full.json (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); process.exit(1); });
