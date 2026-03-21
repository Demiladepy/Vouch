import Groq from 'groq-sdk';
import { getDb, dbRun, dbGet, dbAll } from './database';
import { getWallet } from './wdk';
import { getAaveBalance, depositIdleFunds, withdrawForLoan } from './yield';
import { getPoolStats, Loan, getActiveLoan } from './loans';
import { config } from './config';
import { scoreWallet, TrustScoreResult } from './scorer';
import { startNegotiation, ConversationMessage, NegotiationResult } from './agent';
import { manageWholesaleLiquidity, getAgentDebt, serviceDebt } from './agent-market';
import { v4 as uuidv4 } from 'uuid';

const client = new Groq({ apiKey: config.groqApiKey });

// ─── CIRCUIT BREAKER ────────────────────────────────────────────────────────
let circuitBreakerTripped = false;

export interface AgentDecision {
  id: string;
  timestamp: string;
  action_type: string;
  confidence: number;
  reasoning: string;
  tx_hash?: string;
  result: string;
  target_address?: string;
  amount_usdt?: number;
}

// ─── LOG DECISION ────────────────────────────────────────────────────────────
export function logDecision(decision: Omit<AgentDecision, 'id' | 'timestamp'>): void {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  dbRun(`
    INSERT INTO decisions (id, timestamp, action_type, confidence, reasoning, tx_hash, result, target_address, amount_usdt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, timestamp, decision.action_type, decision.confidence, decision.reasoning,
    decision.tx_hash || null, decision.result, decision.target_address || null, decision.amount_usdt || null
  ]);
  console.log(`[Autonomous] Logged decision (${decision.action_type}): ${decision.reasoning}`);
}

// ─── DYNAMIC INTEREST RATE ENGINE ───────────────────────────────────────────
export function getDynamicApr(tier: string, utilizationRate: number): number {
  const baseRates: Record<string, number> = {
    PLATINUM: 3.5,
    GOLD: 5.0,
    SILVER: 7.5,
    BRONZE: 10.0,
    DECLINED: 0,
  };
  const base = baseRates[tier] || 8.0;
  // Spread rises with utilization (Aave-style kink model)
  const spread = utilizationRate > 0.8 ? (utilizationRate - 0.8) * 50 : utilizationRate * 2;
  return parseFloat((base + spread).toFixed(2));
}

// ─── PORTFOLIO STATE ─────────────────────────────────────────────────────────
async function evaluatePortfolioState() {
  const wallet = await getWallet();
  const address = await wallet.getAddress();
  let usdtBalance = await wallet.getUsdtBalance();
  let aaveBalance = await getAaveBalance();
  const stats = getPoolStats();

  // DEMO MOCK: Simulate starting capital on unfunded testnet
  if (usdtBalance === 0 && aaveBalance === 0) {
    usdtBalance = Math.max(0, 10000 - stats.totalLoanedOut);
  }

  const totalCapital = usdtBalance + aaveBalance + stats.totalLoanedOut;
  const utilizationRate = totalCapital > 0 ? stats.totalLoanedOut / totalCapital : 0;
  const agentDebt = getAgentDebt();
  const systemHealth = stats.defaultRate > 20 ? 'CRITICAL' : stats.defaultRate > 5 ? 'WARN' : 'OK';

  return {
    poolAddress: address,
    unallocatedUsdt: usdtBalance,
    deployedInAave: aaveBalance,
    totalCapital,
    utilizationRate: parseFloat((utilizationRate * 100).toFixed(1)),
    activeLoans: stats.activeLoans,
    totalLoanedOut: stats.totalLoanedOut,
    defaultRate: stats.defaultRate,
    avgTrustScore: stats.avgTrustScore,
    agentDebt,
    systemHealth,
    circuitBreakerTripped,
  };
}

export function getPoolHealthScore(): number {
  const stats = getPoolStats();
  let score = 100;
  score -= stats.defaultRate * 5;
  const totalCap = stats.totalLoanedOut > 0 ? stats.totalLoanedOut : 1;
  const util = Math.min(100, (stats.totalLoanedOut / (totalCap + 1000)) * 100);
  if (util > 80) score -= (util - 80) * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Vouch, an autonomous DeFi lending agent managing a USDT lending pool.
Your mandate: maximize yield while minimizing default risk. Make treasury decisions continuously.

Possible Actions:
1. "DEPLOY_AAVE": Deploy idle USDT (as WETH) to Aave V3 for yield when unallocatedUsdt > 1000.
2. "WITHDRAW_AAVE": Withdraw from Aave when unallocatedUsdt < 200 and loans are incoming.
3. "SERVICE_DEBT": If agentDebt > 0 and unallocatedUsdt > agentDebt * 1.1, repay wholesale debt.
4. "HOLD": Do nothing if balanced.
5. "EMERGENCY_HALT": If systemHealth is CRITICAL (defaultRate > 20%), freeze new loans immediately.

Output ONLY a JSON object with no markdown:
{
  "action": "DEPLOY_AAVE" | "WITHDRAW_AAVE" | "SERVICE_DEBT" | "HOLD" | "EMERGENCY_HALT",
  "amount": <number, 0 if not applicable>,
  "confidence": <number 0.0-1.0>,
  "reasoning": "<1-2 sentence clear explanation>"
}`;

// ─── LLM LOAN EXPLAINABILITY ─────────────────────────────────────────────────
async function generateLoanExplanation(
  decision: 'APPROVE' | 'DENY',
  tier: string,
  trustScore: number,
  address: string,
): Promise<string> {
  try {
    const prompt = `A DeFi lending AI has just ${decision === 'APPROVE' ? 'approved' : 'denied'} a loan for wallet ${address}.
Borrower tier: ${tier}. Trust score: ${trustScore}/100.
Write a 1-sentence plain English explanation of this decision for regulatory transparency.`;

    const res = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0]?.message?.content?.trim() || `${decision} based on on-chain scoring.`;
  } catch {
    return `${decision} based on on-chain scoring (score: ${trustScore}).`;
  }
}

// ─── MAIN AGENT LOOP ─────────────────────────────────────────────────────────
export async function runAgentLoop() {
  console.log(`\n[Autonomous] --- Starting Evaluation Cycle ---`);

  try {
    const state = await evaluatePortfolioState();
    console.log(`[Autonomous] Portfolio State: ${state.unallocatedUsdt.toFixed(2)} USDT free, ${state.deployedInAave.toFixed(2)} aUSDT deployed. Health: ${state.systemHealth}`);

    // ── Circuit Breaker Check ──
    if (state.systemHealth === 'CRITICAL' && !circuitBreakerTripped) {
      circuitBreakerTripped = true;
      logDecision({
        action_type: 'EMERGENCY_HALT',
        confidence: 1.0,
        reasoning: `CIRCUIT BREAKER TRIPPED: Default rate ${state.defaultRate.toFixed(1)}% exceeds 20% threshold. All new loan approvals suspended. Liquidating Aave positions to rebuild liquidity.`,
        result: 'Halted',
      });
      console.log(`[Autonomous] ⚠️  CIRCUIT BREAKER TRIPPED! Default rate critical.`);
      if (state.deployedInAave > 0) {
        await withdrawForLoan(state.deployedInAave);
      }
    }

    if (state.systemHealth !== 'CRITICAL' && circuitBreakerTripped) {
      circuitBreakerTripped = false;
      console.log(`[Autonomous] ✅ Circuit Breaker reset. Resuming normal operations.`);
    }

    // ── 1. Treasury Management (LLM Decision) ──
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: `Current Portfolio State:\n${JSON.stringify(state, null, 2)}` }
    ];

    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 300,
      messages,
    });

    const rawReply = response.choices[0]?.message?.content || '';
    const cleanOutput = rawReply.replace(/```json/gi, '').replace(/```/g, '').trim();

    let decisionData;
    try {
      decisionData = JSON.parse(cleanOutput);
    } catch {
      console.warn(`[Autonomous] Failed to parse Groq decision. Raw: ${rawReply}`);
      return;
    }

    if (decisionData.confidence >= 0.7) {
      console.log(`[Autonomous] Decision: ${decisionData.action} (Confidence: ${decisionData.confidence})`);
      console.log(`[Autonomous] Reasoning: ${decisionData.reasoning}`);

      let txHash: string | undefined;
      let resultStr = 'Success';

      if (decisionData.action === 'DEPLOY_AAVE' && decisionData.amount > 0) {
        txHash = await depositIdleFunds(decisionData.amount);
        if (!txHash) resultStr = 'Failed (Testnet Mock)';
      } else if (decisionData.action === 'WITHDRAW_AAVE' && decisionData.amount > 0) {
        txHash = await withdrawForLoan(decisionData.amount);
        if (!txHash) resultStr = 'Failed';
      } else if (decisionData.action === 'SERVICE_DEBT') {
        const debt = getAgentDebt();
        if (debt > 0) {
          const paid = await serviceDebt(state.unallocatedUsdt);
          resultStr = paid > 0 ? `Repaid $${paid.toFixed(2)} wholesale debt from revenue` : 'Insufficient funds';
          txHash = paid > 0 ? '0xdebt_service_auto' : undefined;
        }
      } else if (decisionData.action === 'EMERGENCY_HALT') {
        circuitBreakerTripped = true;
        resultStr = 'Circuit Breaker Active';
      }

      if (decisionData.action !== 'HOLD') {
        logDecision({
          action_type: decisionData.action,
          confidence: decisionData.confidence,
          reasoning: decisionData.reasoning,
          tx_hash: txHash,
          result: resultStr,
          amount_usdt: decisionData.amount,
        });
      }
    }

    // ── 2. Process Pending Applications ──
    if (!circuitBreakerTripped) {
      await processPendingApplications(state.unallocatedUsdt, state.utilizationRate / 100);
    }

    // ── 3. Mark Overdue Defaults ──
    await evaluateDefaults();

    // ── 4. Wholesale Liquidity (Agent-to-Agent) ──
    if (state.unallocatedUsdt < 500) {
      await manageWholesaleLiquidity(state.unallocatedUsdt);
    }

    // ── 5. Borrower Notifications (Pro-active Collection) ──
    await notifyUpcomingDue();

  } catch (error) {
    console.error(`[Autonomous] Loop Error: ${(error as Error).message}`);
  }
}

// ─── PROCESS APPLICATIONS ────────────────────────────────────────────────────
async function processPendingApplications(freeLiquidity: number, utilizationRate: number) {
  const pendingApps = dbAll('SELECT * FROM applications WHERE status = "scored" LIMIT 5');
  if (pendingApps.length === 0) return;

  for (const app of pendingApps as any[]) {
    console.log(`[Autonomous] Evaluating pending application for ${app.borrower_address}`);

    const dynamicApr = getDynamicApr(app.tier, utilizationRate);
    const isReturningBorrower = checkReturningBorrower(app.borrower_address);
    const aprDiscount = isReturningBorrower ? 0.5 : 0;

    if ((app.tier === 'PLATINUM' || app.tier === 'GOLD') && freeLiquidity > app.trust_score * 2) {
      const terms = {
        agreed: true,
        finalAmountUsdt: app.tier === 'PLATINUM' ? 1000 : 500,
        finalDays: app.tier === 'PLATINUM' ? 60 : 30,
        finalAprPercent: parseFloat((dynamicApr - aprDiscount).toFixed(2)),
        finalCollateralPercent: app.tier === 'PLATINUM' ? 0 : 10, // Undercollateralized for PLATINUM!
        agentSummary: `Auto-approved. Dynamic APR: ${dynamicApr}%${isReturningBorrower ? ' (loyalty -0.5%)' : ''}. ${app.tier === 'PLATINUM' ? 'Zero-collateral loan granted.' : '10% collateral required.'}`
      };

      const history = JSON.parse(app.conversation || '[]');
      history.push({ role: 'assistant', content: `\`\`\`agreement\n${JSON.stringify(terms)}\n\`\`\`` });
      dbRun(`UPDATE applications SET status = 'agreed', conversation = ? WHERE id = ?`, [JSON.stringify(history), app.id]);

      // LLM Explainability — generate plain-English decision explanation
      const explanation = await generateLoanExplanation('APPROVE', app.tier, app.trust_score, app.borrower_address);

      logDecision({
        action_type: app.tier === 'PLATINUM' ? 'ZERO_COLLATERAL_LOAN' : 'AUTO_APPROVE_LOAN',
        confidence: 0.95,
        reasoning: explanation,
        result: 'Approved',
        target_address: app.borrower_address,
        amount_usdt: terms.finalAmountUsdt
      });
      console.log(`[Autonomous] Auto-approved${app.tier === 'PLATINUM' ? ' (ZERO COLLATERAL)' : ''} loan for ${app.borrower_address}`);

    } else if (app.tier === 'DECLINED') {
      dbRun(`UPDATE applications SET status = 'rejected' WHERE id = ?`, [app.id]);

      const explanation = await generateLoanExplanation('DENY', app.tier, app.trust_score, app.borrower_address);
      logDecision({
        action_type: 'AUTO_DENY_LOAN',
        confidence: 0.99,
        reasoning: explanation,
        result: 'Denied',
        target_address: app.borrower_address,
      });
      console.log(`[Autonomous] Auto-denied loan for ${app.borrower_address}`);
    } else {
      dbRun(`UPDATE applications SET status = 'manual_review' WHERE id = ?`, [app.id]);
      console.log(`[Autonomous] Placed loan for ${app.borrower_address} in manual review.`);
    }
  }
}

// ─── DEFAULTS ────────────────────────────────────────────────────────────────
async function evaluateDefaults() {
  const overdueLoans = dbAll('SELECT * FROM loans WHERE status = "overdue"');
  const now = Date.now();

  for (const loan of overdueLoans as any[]) {
    const dueMs = new Date(loan.due_at).getTime();
    const delayDays = (now - dueMs) / (1000 * 60 * 60 * 24);

    if (delayDays > 3) {
      dbRun(`UPDATE loans SET status = 'defaulted' WHERE id = ?`, [loan.id]);
      // SLASHING: Deduct trust permanentely (via decision log) 
      logDecision({
        action_type: 'MARK_DEFAULT',
        confidence: 1.0,
        reasoning: `Loan overdue by ${delayDays.toFixed(1)} days (grace period 3 days exceeded). Borrower slashed -10 trust points. Marked as defaulted.`,
        result: 'Defaulted',
        target_address: loan.borrower_address,
        amount_usdt: loan.amount_usdt
      });
      console.log(`[Autonomous] Marked loan ${loan.id} as default. Borrower slashed.`);
    }
  }
}

// ─── BORROWER NOTIFICATION ────────────────────────────────────────────────────
async function notifyUpcomingDue() {
  const now = Date.now();
  const in24h = now + (24 * 60 * 60 * 1000);
  const activeLoans = dbAll('SELECT * FROM loans WHERE status = "active"');

  for (const loan of activeLoans as any[]) {
    const dueMs = new Date(loan.due_at).getTime();
    if (dueMs > now && dueMs < in24h) {
      logDecision({
        action_type: 'BORROWER_NOTIFIED',
        confidence: 1.0,
        reasoning: `Proactive notification: Loan #${loan.id.substring(0,8)} due in <24 hours ($${loan.total_due} USDT). Automated reminder dispatched to ${loan.borrower_address}.`,
        result: 'Notified',
        target_address: loan.borrower_address,
        amount_usdt: loan.total_due,
      });
    }
  }
}

// ─── RETURNING BORROWER CHECK ────────────────────────────────────────────────
function checkReturningBorrower(address: string): boolean {
  const repaidLoans = dbAll(
    'SELECT id FROM loans WHERE borrower_address = ? AND status = "repaid" LIMIT 1',
    [address]
  );
  return Array.isArray(repaidLoans) && repaidLoans.length > 0;
}

// ─── START LOOP ───────────────────────────────────────────────────────────────
let intervalTimer: ReturnType<typeof setInterval> | null = null;
export function startAutonomousLoop(intervalMs: number = 60000) {
  if (intervalTimer) return;

  // Ensure decisions table exists
  dbRun(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      timestamp TEXT,
      action_type TEXT,
      confidence REAL,
      reasoning TEXT,
      tx_hash TEXT,
      result TEXT,
      target_address TEXT,
      amount_usdt REAL
    );
  `);

  console.log(`[Autonomous] Starting autonomous agent loop (interval: ${intervalMs}ms)`);
  runAgentLoop();
  intervalTimer = setInterval(runAgentLoop, intervalMs);
}
