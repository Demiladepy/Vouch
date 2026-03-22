/**
 * Demo Data Seeding Script
 * Run: npx ts-node scripts/seed-demo.ts
 * Safe to run multiple times (idempotent — clears and re-seeds)
 */
import path from 'path';
import fs from 'fs';
import initSqlJs from 'sql.js';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = path.resolve(process.cwd(), 'vouch.db');

async function seed() {
  console.log('[Seed] Starting demo data seed...');

  const SQL = await initSqlJs();
  let db: InstanceType<typeof SQL.Database>;

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('[Seed] Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('[Seed] Created new database');

    db.run(`CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, borrower_address TEXT NOT NULL, trust_score INTEGER,
      tier TEXT, conversation TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY, borrower_address TEXT NOT NULL, trust_score INTEGER, tier TEXT,
      amount_usdt REAL, duration_days INTEGER, apr_percent REAL, collateral_percent REAL,
      collateral_amount_usdt REAL DEFAULT 0, disbursed_at TEXT, due_at TEXT, repaid_at TEXT,
      tx_hash_disbursement TEXT, tx_hash_repayment TEXT, status TEXT DEFAULT 'active',
      interest_due REAL DEFAULT 0, total_due REAL DEFAULT 0
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_address)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status)`);
  }

  // Clear existing demo data (loans with demo_ prefix in tx_hash)
  db.run(`DELETE FROM loans WHERE tx_hash_disbursement LIKE 'demo_%'`);
  db.run(`DELETE FROM applications WHERE id LIKE 'demo_%'`);
  console.log('[Seed] Cleared previous demo data');

  // --- Known wallets to pre-score ---
  const wallets = [
    { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', name: 'vitalik.eth', score: 92, tier: 'PLATINUM' },
    { address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', name: 'Binance Hot', score: 88, tier: 'GOLD' },
    { address: '0x2FAF487A4414Fe77e2327F0bf4AE2a264a776AD2', name: 'FTX Wallet', score: 28, tier: 'DECLINED' },
    { address: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326', name: 'Coinbase Builder', score: 78, tier: 'GOLD' },
    { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', name: 'Binance Cold', score: 82, tier: 'GOLD' },
    { address: '0x8EB8a3b98659Cce290402893d0123abb75E3ab28', name: 'Uniswap Deployer', score: 95, tier: 'PLATINUM' },
    { address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', name: 'Ethereum ICO', score: 71, tier: 'SILVER' },
    { address: '0x0000000000000000000000000000000000000001', name: 'Fresh Wallet', score: 6, tier: 'DECLINED' },
  ];

  // Insert scored applications
  for (const w of wallets) {
    const appId = `demo_app_${w.address.slice(2, 10)}`;
    db.run(
      `INSERT OR REPLACE INTO applications (id, borrower_address, trust_score, tier, conversation, status, created_at)
       VALUES (?, ?, ?, ?, '[]', 'scored', datetime('now', '-' || ? || ' hours'))`,
      [appId, w.address, w.score, w.tier, Math.floor(Math.random() * 72)]
    );
  }
  console.log(`[Seed] Inserted ${wallets.length} scored applications`);

  // --- Demo loans ---
  const now = Date.now();
  const DAY = 86400000;

  const demoLoans = [
    {
      // Just disbursed — Platinum borrower, 30 days remaining
      borrower: wallets[0],
      amount: 800,
      days: 30,
      apr: 4.5,
      collateral: 0,
      disbursedAgo: 2 * DAY,
      status: 'active',
    },
    {
      // Mid-repayment — Gold borrower, 15 of 30 days elapsed
      borrower: wallets[3],
      amount: 400,
      days: 30,
      apr: 6.5,
      collateral: 10,
      disbursedAgo: 15 * DAY,
      status: 'active',
    },
    {
      // Near due date — Silver borrower, 12 of 14 days elapsed
      borrower: wallets[6],
      amount: 150,
      days: 14,
      apr: 9.0,
      collateral: 30,
      disbursedAgo: 12 * DAY,
      status: 'active',
    },
    {
      // Already repaid — Gold borrower
      borrower: wallets[4],
      amount: 300,
      days: 14,
      apr: 6.5,
      collateral: 10,
      disbursedAgo: 20 * DAY,
      status: 'repaid',
    },
  ];

  for (const dl of demoLoans) {
    const id = uuidv4();
    const interest = parseFloat((dl.amount * (dl.apr / 100) * (dl.days / 365)).toFixed(6));
    const totalDue = parseFloat((dl.amount + interest).toFixed(6));
    const collateralAmt = parseFloat((dl.amount * (dl.collateral / 100)).toFixed(6));
    const disbursedAt = new Date(now - dl.disbursedAgo).toISOString();
    const dueAt = new Date(now - dl.disbursedAgo + dl.days * DAY).toISOString();
    const txHash = `demo_0x${Buffer.from(id).toString('hex').slice(0, 62)}`;
    const repaidAt = dl.status === 'repaid' ? new Date(now - 5 * DAY).toISOString() : null;
    const repayTx = dl.status === 'repaid' ? `demo_0xrepay${Buffer.from(id).toString('hex').slice(0, 56)}` : null;

    db.run(`
      INSERT INTO loans (id, borrower_address, trust_score, tier, amount_usdt, duration_days,
        apr_percent, collateral_percent, collateral_amount_usdt, disbursed_at, due_at,
        repaid_at, tx_hash_disbursement, tx_hash_repayment, status, interest_due, total_due)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, dl.borrower.address, dl.borrower.score, dl.borrower.tier,
      dl.amount, dl.days, dl.apr, dl.collateral, collateralAmt,
      disbursedAt, dueAt, repaidAt, txHash, repayTx,
      dl.status, interest, totalDue,
    ]);
  }
  console.log(`[Seed] Inserted ${demoLoans.length} demo loans`);

  // Save
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  console.log(`[Seed] Database saved to ${DB_PATH}`);

  // Summary
  const loanCount = db.exec('SELECT COUNT(*) FROM loans')[0]?.values[0]?.[0];
  const appCount = db.exec('SELECT COUNT(*) FROM applications')[0]?.values[0]?.[0];
  console.log(`[Seed] Total: ${appCount} applications, ${loanCount} loans`);
  console.log('[Seed] Done!');
}

seed().catch(err => {
  console.error('[Seed] Fatal error:', err);
  process.exit(1);
});
