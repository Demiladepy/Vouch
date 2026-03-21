import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet, dbAll } from './database';
import { getWallet } from './wdk';
import { NegotiationResult } from './agent';

export interface Loan {
  id: string;
  borrower_address: string;
  trust_score: number;
  tier: string;
  amount_usdt: number;
  duration_days: number;
  apr_percent: number;
  collateral_percent: number;
  collateral_amount_usdt: number;
  disbursed_at: string;
  due_at: string;
  repaid_at: string | null;
  tx_hash_disbursement: string;
  tx_hash_repayment: string | null;
  status: string;
  interest_due: number;
  total_due: number;
}

export async function disburseLoan(
  borrowerAddress: string,
  trustScore: number,
  tier: string,
  agreement: NegotiationResult,
): Promise<Loan> {
  // Prevent double-borrowing
  const existing = getActiveLoan(borrowerAddress);
  if (existing) {
    throw new Error(`Borrower ${borrowerAddress} already has an active loan (${existing.id})`);
  }

  const { finalAmountUsdt, finalDays, finalAprPercent, finalCollateralPercent } = agreement;

  // Calculate interest (simple interest)
  const interestDue = parseFloat((finalAmountUsdt * (finalAprPercent / 100) * (finalDays / 365)).toFixed(6));
  const totalDue = parseFloat((finalAmountUsdt + interestDue).toFixed(6));
  const collateralAmount = parseFloat((finalAmountUsdt * (finalCollateralPercent / 100)).toFixed(6));

  // Send USDT via WDK
  console.log(`[Vouch] Disbursing ${finalAmountUsdt} USDT to ${borrowerAddress}`);
  const wallet = await getWallet();
  const txHash = await wallet.sendUsdt(borrowerAddress, finalAmountUsdt);

  const id = uuidv4();
  const now = new Date();
  const dueDate = new Date(now.getTime() + finalDays * 86400000);
  const disbursedAt = now.toISOString();
  const dueAt = dueDate.toISOString();

  dbRun(`
    INSERT INTO loans (
      id, borrower_address, trust_score, tier, amount_usdt, duration_days,
      apr_percent, collateral_percent, collateral_amount_usdt,
      disbursed_at, due_at, tx_hash_disbursement, status, interest_due, total_due
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `, [
    id, borrowerAddress, trustScore, tier, finalAmountUsdt, finalDays,
    finalAprPercent, finalCollateralPercent, collateralAmount,
    disbursedAt, dueAt, txHash, interestDue, totalDue,
  ]);

  console.log(`[Vouch] Loan ${id} disbursed: ${finalAmountUsdt} USDT, due ${dueAt}`);

  return {
    id,
    borrower_address: borrowerAddress,
    trust_score: trustScore,
    tier,
    amount_usdt: finalAmountUsdt,
    duration_days: finalDays,
    apr_percent: finalAprPercent,
    collateral_percent: finalCollateralPercent,
    collateral_amount_usdt: collateralAmount,
    disbursed_at: disbursedAt,
    due_at: dueAt,
    repaid_at: null,
    tx_hash_disbursement: txHash,
    tx_hash_repayment: null,
    status: 'active',
    interest_due: interestDue,
    total_due: totalDue,
  };
}

export function getActiveLoan(address: string): Loan | undefined {
  const row = dbGet<Loan>(
    `SELECT * FROM loans WHERE borrower_address = ? AND status = 'active' LIMIT 1`,
    [address],
  );

  // Also check with lowercase
  if (!row) {
    return dbGet<Loan>(
      `SELECT * FROM loans WHERE borrower_address = ? AND status = 'active' LIMIT 1`,
      [address.toLowerCase()],
    );
  }
  return row;
}

export function getAllLoans(): Loan[] {
  return dbAll<Loan>(`SELECT * FROM loans ORDER BY disbursed_at DESC`);
}

export function getPoolStats(): {
  totalLoanedOut: number;
  activeLoans: number;
  totalRepaid: number;
  defaultRate: number;
  avgTrustScore: number;
} {
  const active = dbGet<{ cnt: number; total: number }>(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(amount_usdt), 0) as total FROM loans WHERE status = 'active'`,
  ) || { cnt: 0, total: 0 };

  const repaid = dbGet<{ cnt: number; total: number }>(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(amount_usdt), 0) as total FROM loans WHERE status = 'repaid'`,
  ) || { cnt: 0, total: 0 };

  const defaulted = dbGet<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM loans WHERE status = 'defaulted'`,
  ) || { cnt: 0 };

  const allCount = dbGet<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM loans`,
  ) || { cnt: 0 };

  const avgScore = dbGet<{ avg: number }>(
    `SELECT COALESCE(AVG(trust_score), 0) as avg FROM loans`,
  ) || { avg: 0 };

  const totalLoans = allCount.cnt || 1;

  return {
    totalLoanedOut: active.total,
    activeLoans: active.cnt,
    totalRepaid: repaid.total,
    defaultRate: parseFloat(((defaulted.cnt / totalLoans) * 100).toFixed(2)),
    avgTrustScore: Math.round(avgScore.avg),
  };
}
