import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'vouch.db');

let db: SqlJsDatabase | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (db) {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    }
  }, 500);
}

export async function initDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  console.log(`[Vouch] Opening database at ${DB_PATH}`);
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('[Vouch] Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('[Vouch] Created new database');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      borrower_address TEXT NOT NULL,
      trust_score INTEGER,
      tier TEXT,
      conversation TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      borrower_address TEXT NOT NULL,
      trust_score INTEGER,
      tier TEXT,
      amount_usdt REAL,
      duration_days INTEGER,
      apr_percent REAL,
      collateral_percent REAL,
      collateral_amount_usdt REAL DEFAULT 0,
      disbursed_at TEXT,
      due_at TEXT,
      repaid_at TEXT,
      tx_hash_disbursement TEXT,
      tx_hash_repayment TEXT,
      status TEXT DEFAULT 'active',
      interest_due REAL DEFAULT 0,
      total_due REAL DEFAULT 0
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_address);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);`);

  // Persist initial schema
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));

  console.log('[Vouch] Database initialized');
  return db;
}

export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error('[Vouch] Database not initialized. Call initDb() first.');
  }
  return db;
}

// Helpers that mirror better-sqlite3 style but work with sql.js

export function dbRun(sql: string, params: unknown[] = []): void {
  const d = getDb();
  d.run(sql, params as (string | number | null | Uint8Array)[]);
  scheduleSave();
}

export function dbGet<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const d = getDb();
  const stmt = d.prepare(sql);
  stmt.bind(params as (string | number | null | Uint8Array)[]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as T;
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

export function dbAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const d = getDb();
  const results: T[] = [];
  const stmt = d.prepare(sql);
  stmt.bind(params as (string | number | null | Uint8Array)[]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}
