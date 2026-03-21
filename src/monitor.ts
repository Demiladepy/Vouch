import cron from 'node-cron';
import axios from 'axios';
import { dbAll, dbRun, dbGet } from './database';
import { Loan } from './loans';
import { getWallet } from './wdk';
import { config } from './config';
import { logDecision } from './autonomous';

export function startRepaymentMonitor(): void {
  console.log('[Vouch] Starting repayment monitor (every 5 mins)');

  cron.schedule('*/5 * * * *', () => {
    checkRepayments();
  });

  // Also run once on startup
  checkRepayments();
}

export async function checkRepayments(): Promise<void> {
  const now = new Date().toISOString();

  // 1. Mark overdue loans
  const overdue = dbAll<Loan>(
    `SELECT * FROM loans WHERE status = 'active' AND due_at < ?`,
    [now],
  );

  if (overdue.length > 0) {
    console.log(`[Vouch] Found ${overdue.length} overdue loan(s)`);
    for (const loan of overdue) {
      dbRun(`UPDATE loans SET status = 'overdue' WHERE id = ?`, [loan.id]);
      console.log(`[Vouch] Loan ${loan.id} marked overdue — borrower: ${loan.borrower_address}, amount: ${loan.amount_usdt} USDT, due: ${loan.due_at}`);
    }
  }

  // 2. Scan on-chain for repayments
  await scanOnChainRepayments();
}

async function scanOnChainRepayments() {
   try {
     const wallet = await getWallet();
     const poolAddress = await wallet.getAddress();
     const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
     
     const baseUrl = 'https://api-sepolia.arbiscan.io/api';
     const apiKeyParam = config.etherscanApiKey ? `&apikey=${config.etherscanApiKey}` : '';
     // Fetch recent ERC20 txs for the pool wallet
     const url = `${baseUrl}?module=account&action=tokentx&contractaddress=${USDT_ADDRESS}&address=${poolAddress}&page=1&offset=50&sort=desc${apiKeyParam}`;
     
     const resp = await axios.get(url, { timeout: 10000 });
     if (resp.data.status !== '1' || !Array.isArray(resp.data.result)) return;

     const activeLoans = dbAll<Loan>(`SELECT * FROM loans WHERE status = 'active' OR status = 'overdue'`);
     if (activeLoans.length === 0) return;

     const txs = resp.data.result;

     for (const tx of txs) {
        // Only process incoming transfers
        if (tx.to.toLowerCase() !== poolAddress.toLowerCase()) continue;
        
        const sender = tx.from.toLowerCase();
        const valueUsdt = Number(tx.value) / 1e6;
        const txHash = tx.hash;

        // Has this already been processed? (naive check: tx_hash_repayment is populated)
        const alreadyProcessed = dbGet(`SELECT id FROM loans WHERE tx_hash_repayment = ?`, [txHash]);
        if (alreadyProcessed) continue;

        // Does this match a borrower?
        const loan = activeLoans.find(l => l.borrower_address.toLowerCase() === sender);
        if (loan) {
           console.log(`[Vouch] Found on-chain repayment of ${valueUsdt} USDT from ${sender}. Processing...`);
           const res = processRepayment(loan.id, txHash, valueUsdt);
           
           if (res.success && res.message.includes('fully repaid')) {
              logDecision({
                  action_type: 'PROCESS_REPAYMENT',
                  confidence: 1.0,
                  reasoning: `Detected full repayment of ${valueUsdt} USDT on-chain. Loan marked as repaid.`,
                  result: 'Repaid',
                  target_address: sender,
                  amount_usdt: valueUsdt,
                  tx_hash: txHash
              });
              
              // Boost trust score
              dbRun(`UPDATE applications SET trust_score = trust_score + 5 WHERE borrower_address = ?`, [loan.borrower_address]);
           }
        }
     }
   } catch(err) {
      console.error(`[Vouch] Error scanning on-chain repayments: ${(err as Error).message}`);
   }
}

export function processRepayment(
  loanId: string,
  txHash: string,
  amount: number,
): { success: boolean; message: string } {
  const loan = dbGet<Loan>(`SELECT * FROM loans WHERE id = ?`, [loanId]);
  if (!loan) {
    return { success: false, message: `Loan ${loanId} not found` };
  }

  if (loan.status === 'repaid') {
    return { success: false, message: `Loan ${loanId} is already repaid` };
  }

  if (amount >= loan.total_due) {
    dbRun(
      `UPDATE loans SET status = 'repaid', repaid_at = datetime('now'), tx_hash_repayment = ? WHERE id = ?`,
      [txHash, loanId],
    );
    console.log(`[Vouch] Loan ${loanId} fully repaid — tx: ${txHash}`);
    return { success: true, message: `Loan fully repaid. Thank you!` };
  }

  // Partial repayment — keep active but log
  console.log(`[Vouch] Partial repayment on loan ${loanId}: ${amount} of ${loan.total_due} USDT`);
  return { success: true, message: `Partial payment of ${amount} USDT received. Remaining: ${(loan.total_due - amount).toFixed(2)} USDT` };
}
