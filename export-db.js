const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const p = new PrismaClient();

async function main() {
  const tables = {};

  console.log('Exporting database...');

  tables.users = await p.user.findMany();
  console.log(`  users: ${tables.users.length}`);

  tables.wallets = await p.wallet.findMany();
  console.log(`  wallets: ${tables.wallets.length}`);

  tables.polymarketTraders = await p.polymarketTrader.findMany();
  console.log(`  polymarketTraders: ${tables.polymarketTraders.length}`);

  tables.traderScores = await p.traderScore.findMany();
  console.log(`  traderScores: ${tables.traderScores.length}`);

  tables.groups = await p.group.findMany();
  console.log(`  groups: ${tables.groups.length}`);

  tables.groupReviews = await p.groupReview.findMany();
  console.log(`  groupReviews: ${tables.groupReviews.length}`);

  tables.subscriptions = await p.subscription.findMany();
  console.log(`  subscriptions: ${tables.subscriptions.length}`);

  tables.predictions = await p.prediction.findMany();
  console.log(`  predictions: ${tables.predictions.length}`);

  tables.intelligenceRankings = await p.intelligenceRanking.findMany();
  console.log(`  intelligenceRankings: ${tables.intelligenceRankings.length}`);

  tables.expertBots = await p.expertBot.findMany();
  console.log(`  expertBots: ${tables.expertBots.length}`);

  tables.groupComments = await p.groupComment.findMany();
  console.log(`  groupComments: ${tables.groupComments.length}`);

  tables.expertPayouts = await p.expertPayout.findMany();
  console.log(`  expertPayouts: ${tables.expertPayouts.length}`);

  tables.agentKeys = await p.agentKey.findMany();
  console.log(`  agentKeys: ${tables.agentKeys.length}`);

  tables.platformSettings = await p.platformSettings.findMany();
  console.log(`  platformSettings: ${tables.platformSettings.length}`);

  tables.sessions = await p.session.findMany();
  console.log(`  sessions: ${tables.sessions.length}`);

  tables.accounts = await p.account.findMany();
  console.log(`  accounts: ${tables.accounts.length}`);

  tables.polymarketTrades = await p.polymarketTrade.findMany();
  console.log(`  polymarketTrades: ${tables.polymarketTrades.length}`);

  tables.polymarketPositions = await p.polymarketPosition.findMany();
  console.log(`  polymarketPositions: ${tables.polymarketPositions.length}`);

  tables.marketSnapshots = await p.marketSnapshot.findMany();
  console.log(`  marketSnapshots: ${tables.marketSnapshots.length}`);

  tables.traderMetricHistories = await p.traderMetricHistory.findMany();
  console.log(`  traderMetricHistories: ${tables.traderMetricHistories.length}`);

  const json = JSON.stringify(tables, null, 2);
  fs.writeFileSync('db-backup.json', json);
  console.log(`\nSaved db-backup.json (${(json.length / 1024).toFixed(1)} KB)`);
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); process.exit(1); });
