const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const DB_URL = process.argv[2] || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('Usage: node restore-db.js <DATABASE_URL>');
  process.exit(1);
}

const p = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  const data = JSON.parse(fs.readFileSync('db-backup.json', 'utf8'));
  let total = 0;

  console.log('Restoring database...');

  // Order matters for FK constraints
  const tables = [
    'platformSettings',
    'users',
    'wallets',
    'polymarketTraders',
    'traderScores',
    'groups',
    'subscriptions',
    'groupReviews',
    'predictions',
    'groupComments',
    'expertBots',
    'expertPayouts',
    'agentKeys',
    'accounts',
    'sessions',
    'polymarketTrades',
    'polymarketPositions',
    'marketSnapshots',
    'traderMetricHistories',
  ];

  for (const table of tables) {
    const items = data[table];
    if (!items || items.length === 0) continue;
    try {
      // @ts-ignore
      const result = await p[table].createMany({ data: items, skipDuplicates: true });
      total += result.count;
      console.log(`  ${table}: restored ${result.count}`);
    } catch (e) {
      console.error(`  ${table}: FAILED - ${e.message}`);
    }
  }

  console.log(`\nDone. Total rows restored: ${total}`);
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); process.exit(1); });
