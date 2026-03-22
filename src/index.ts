import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { initDb, dbGet, dbRun } from './database';
import { getWallet } from './wdk';
import { scoreWallet, TrustScoreResult } from './scorer';
import { startNegotiation, ConversationMessage, NegotiationResult } from './agent';
import { disburseLoan, getActiveLoan, getAllLoans, getPoolStats } from './loans';
import { startRepaymentMonitor, processRepayment } from './monitor';
import { getAaveBalance } from './yield';
import { getEthUsdtPrice } from './oracle';
import { sendWebhook } from './webhooks';
import { v4 as uuidv4 } from 'uuid';
import { startAutonomousLoop, getPoolHealthScore, getDynamicApr } from './autonomous';
import { getAgentDebt } from './agent-market';
import { generateZKProof, verifyZKProof } from './zkp';
import { dbAll } from './database';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Health ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Score a wallet ---
app.post('/api/score', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({ error: 'Invalid Ethereum address. Must be a 0x-prefixed 40-char hex string.' });
      return;
    }

    console.log(`[Vouch] POST /api/score — ${address}`);
    const result = await scoreWallet(address);

    // Save application
    const appId = uuidv4();
    dbRun(`
      INSERT INTO applications (id, borrower_address, trust_score, tier, conversation, status)
      VALUES (?, ?, ?, ?, ?, 'scored')
    `, [appId, address, result.score, result.tier, JSON.stringify([])]);

    sendWebhook('score', { wallet: address, score: result.score, tier: result.tier }).catch(() => {});

    res.json({ applicationId: appId, ...result });
  } catch (err) {
    console.error('[Vouch] Score error:', err);
    res.status(500).json({ error: 'Failed to score wallet. Please try again.' });
  }
});

interface ApplicationRow {
  id: string;
  borrower_address: string;
  trust_score: number;
  tier: string;
  conversation: string;
  status: string;
}

// --- Negotiate ---
app.post('/api/negotiate', async (req, res) => {
  try {
    const { applicationId, message } = req.body;
    if (!applicationId) {
      res.status(400).json({ error: 'Missing applicationId' });
      return;
    }

    const app = dbGet<ApplicationRow>(`SELECT * FROM applications WHERE id = ?`, [applicationId]);

    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    console.log(`[Vouch] POST /api/negotiate — app ${applicationId}, message: ${message ? String(message).substring(0, 50) : '(initial)'}`);

    // Reconstruct score result for context
    const scoreResult: TrustScoreResult = {
      address: app.borrower_address,
      score: app.trust_score,
      tier: app.tier,
      did: `did:vouch:${app.borrower_address.substring(2, 34).toLowerCase()}`,
      loanTerms: getTierTerms(app.tier),
      breakdown: { walletMaturity: 0, defiDepth: 0, repaymentHistory: 0, assetStability: 0, communitySignals: 0 },
      explanation: [],
      improvementTips: app.tier === 'DECLINED' ? ['Build more on-chain history to qualify for a loan.'] : [],
    };

    const history: ConversationMessage[] = JSON.parse(app.conversation || '[]');
    const result = await startNegotiation(scoreResult, history, message || undefined);

    // Save updated conversation
    dbRun(`UPDATE applications SET conversation = ?, status = ? WHERE id = ?`, [
      JSON.stringify(result.messages),
      result.agreement ? 'agreed' : 'negotiating',
      applicationId,
    ]);

    res.json({
      agentMessage: result.agentReply,
      agreement: result.agreement,
      conversationLength: result.messages.length,
    });
  } catch (err) {
    console.error('[Vouch] Negotiate error:', err);
    res.status(500).json({ error: 'Negotiation failed. Please try again.' });
  }
});

// --- Disburse ---
app.post('/api/disburse', async (req, res) => {
  try {
    const { applicationId } = req.body;
    if (!applicationId) {
      res.status(400).json({ error: 'Missing applicationId' });
      return;
    }

    const app = dbGet<ApplicationRow>(`SELECT * FROM applications WHERE id = ?`, [applicationId]);

    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    if (app.status !== 'agreed') {
      res.status(400).json({ error: 'No agreement reached yet. Continue negotiating.' });
      return;
    }

    // Check double-borrow
    const activeLoan = getActiveLoan(app.borrower_address);
    if (activeLoan) {
      res.status(400).json({ error: 'You already have an active loan. Repay it before borrowing again.' });
      return;
    }

    // Extract agreement from conversation
    const messages: ConversationMessage[] = JSON.parse(app.conversation || '[]');
    const agreement = extractAgreementFromConversation(messages, app.tier);
    if (!agreement) {
      res.status(400).json({ error: 'Could not extract agreement terms. Please renegotiate.' });
      return;
    }

    console.log(`[Vouch] POST /api/disburse — ${app.borrower_address}, ${agreement.finalAmountUsdt} USDT`);

    const loan = await disburseLoan(app.borrower_address, app.trust_score, app.tier, agreement);
    const wallet = await getWallet();
    const explorerUrl = wallet.getExplorerUrl(loan.tx_hash_disbursement);

    dbRun(`UPDATE applications SET status = 'disbursed' WHERE id = ?`, [applicationId]);

    sendWebhook('loan_disbursed', { wallet: app.borrower_address, amount: agreement.finalAmountUsdt, score: app.trust_score, tier: app.tier, loanId: loan.id }).catch(() => {});

    res.json({ loan, explorerUrl });
  } catch (err) {
    console.error('[Vouch] Disburse error:', err);
    res.status(500).json({ error: `Disbursement failed: ${(err as Error).message}` });
  }
});

// --- Repay ---
app.post('/api/repay', async (req, res) => {
  try {
    const { loanId, txHash, amount } = req.body;
    if (!loanId || !txHash || !amount) {
      res.status(400).json({ error: 'Missing loanId, txHash, or amount' });
      return;
    }

    console.log(`[Vouch] POST /api/repay — loan ${loanId}, amount ${amount}`);
    const result = processRepayment(loanId, txHash, Number(amount));

    sendWebhook('repayment', { amount: Number(amount), loanId }).catch(() => {});

    res.json(result);
  } catch (err) {
    console.error('[Vouch] Repay error:', err);
    res.status(500).json({ error: 'Repayment processing failed.' });
  }
});

// --- Status ---
app.get('/api/status', async (_req, res) => {
  try {
    const wallet = await getWallet();
    const address = await wallet.getAddress();
    const balance = await wallet.getUsdtBalance();
    const aaveBalance = await getAaveBalance();
    const stats = getPoolStats();

    res.json({
      pool: {
        address,
        usdtBalance: balance,
        aaveBalance,
        chain: config.wdkChain,
        network: config.network,
      },
      stats,
    });
  } catch (err) {
    console.error('[Vouch] Status error:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// --- Loans ---
app.get('/api/loans', (_req, res) => {
  try {
    const loans = getAllLoans();
    res.json({ loans });
  } catch (err) {
    console.error('[Vouch] Loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// --- Decisions ---
app.get('/api/decisions', (_req, res) => {
  try {
    const limit = parseInt(_req.query.limit as string) || 50;
    const decisions = dbAll(`SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?`, [limit]);
    res.json({ decisions });
  } catch (err) {
    console.error('[Vouch] Decisions error:', err);
    res.status(500).json({ error: 'Failed to fetch decisions' });
  }
});

// --- ZKP Credit Verification ---
app.post('/api/zkp/prove', async (req, res) => {
  try {
    const { address, trustScore } = req.body;
    if (!address || trustScore === undefined) {
      res.status(400).json({ error: 'address and trustScore required' });
      return;
    }
    const proof = generateZKProof(address, trustScore);
    res.json({ proof });
  } catch (err) {
    console.error('[Vouch] ZKP error:', err);
    res.status(500).json({ error: 'Failed to generate ZK proof' });
  }
});

app.post('/api/zkp/verify', async (req, res) => {
  try {
    const { address, proof } = req.body;
    const result = verifyZKProof(proof, address);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify ZK proof' });
  }
});

// --- Pool Health Score ---
app.get('/api/health-score', (_req, res) => {
  try {
    const score = getPoolHealthScore();
    const stats = getPoolStats();
    const agentDebt = getAgentDebt();
    res.json({
      healthScore: score,
      utilizationRate: stats.totalLoanedOut > 0 ? ((stats.totalLoanedOut / (stats.totalLoanedOut + 10000)) * 100).toFixed(1) : 0,
      defaultRate: stats.defaultRate.toFixed(1),
      agentDebt: agentDebt.toFixed(2),
      activeLoans: stats.activeLoans,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute health score' });
  }
});

// --- Dynamic APR Feed ---
app.get('/api/rate', (_req, res) => {
  try {
    const stats = getPoolStats();
    const totalCap = Math.max(stats.totalLoanedOut + 10000, 1);
    const utilization = stats.totalLoanedOut / totalCap;
    res.json({
      tiers: {
        PLATINUM: getDynamicApr('PLATINUM', utilization),
        GOLD: getDynamicApr('GOLD', utilization),
        SILVER: getDynamicApr('SILVER', utilization),
        BRONZE: getDynamicApr('BRONZE', utilization),
      },
      utilizationRate: (utilization * 100).toFixed(1),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

// --- Agent Economy GDP Stats ---
app.get('/api/stats/economy', async (_req, res) => {
  try {
    const stats = getPoolStats();
    const aaveBalance = await getAaveBalance();
    const agentDebt = getAgentDebt();
    const ethPrice = await getEthUsdtPrice();
    const decisions = dbAll('SELECT COUNT(*) as count FROM decisions') as any[];
    const totalDecisions = decisions[0]?.count || 0;
    const gdp = stats.totalLoanedOut + aaveBalance;
    res.json({
      agentGDP: gdp.toFixed(2),
      totalLoanedOut: stats.totalLoanedOut.toFixed(2),
      aaveYield: aaveBalance.toFixed(2),
      agentDebt: agentDebt.toFixed(2),
      activeLoans: stats.activeLoans,
      defaultRate: stats.defaultRate.toFixed(1),
      totalAutonomousDecisions: totalDecisions,
      ethPrice: ethPrice.toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch economy stats' });
  }
});

// --- Serve frontend ---
app.get('/apply', (_req, res) => {
  res.redirect('/');
});

app.get('/explore', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'explore.html'));
});

app.get('/repay', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'repay.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- Helpers ---

function getTierTerms(tier: string): TrustScoreResult['loanTerms'] {
  const tiers: Record<string, TrustScoreResult['loanTerms']> = {
    PLATINUM: { maxAmountUsdt: 1000, maxDurationDays: 60, aprPercent: 4.5, collateralPercent: 0 },
    GOLD:     { maxAmountUsdt: 500,  maxDurationDays: 30, aprPercent: 6.5, collateralPercent: 10 },
    SILVER:   { maxAmountUsdt: 200,  maxDurationDays: 14, aprPercent: 9.0, collateralPercent: 30 },
    BRONZE:   { maxAmountUsdt: 75,   maxDurationDays: 7,  aprPercent: 12.0, collateralPercent: 60 },
    DECLINED: { maxAmountUsdt: 0,    maxDurationDays: 0,  aprPercent: 0,   collateralPercent: 0 },
  };
  return tiers[tier] || tiers.DECLINED;
}

function extractAgreementFromConversation(
  messages: ConversationMessage[],
  tier: string,
): NegotiationResult | null {
  // Look for agreement JSON in assistant messages (most recent first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    const regex = /```agreement\s*\n?([\s\S]*?)\n?```/;
    const match = msg.content.match(regex);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        return {
          agreed: true,
          finalAmountUsdt: Number(parsed.finalAmountUsdt),
          finalDays: Number(parsed.finalDays),
          finalAprPercent: Number(parsed.finalAprPercent),
          finalCollateralPercent: Number(parsed.finalCollateralPercent),
          agentSummary: String(parsed.agentSummary || ''),
        };
      } catch {
        continue;
      }
    }
  }

  // Fallback: use tier defaults if status was already 'agreed'
  const terms = getTierTerms(tier);
  if (terms.maxAmountUsdt > 0) {
    return {
      agreed: true,
      finalAmountUsdt: terms.maxAmountUsdt,
      finalDays: terms.maxDurationDays,
      finalAprPercent: terms.aprPercent,
      finalCollateralPercent: terms.collateralPercent,
      agentSummary: `Default ${tier} tier terms`,
    };
  }

  return null;
}

// --- Startup ---

async function main(): Promise<void> {
  console.log('[Vouch] Starting...');

  // Init database (async for sql.js)
  await initDb();

  // Init wallet
  try {
    const wallet = await getWallet();
    const address = await wallet.getAddress();
    const balance = await wallet.getUsdtBalance();
    console.log(`[Vouch] Pool wallet: ${address}`);
    console.log(`[Vouch] Pool USDT balance: ${balance}`);
  } catch (err) {
    console.error('[Vouch] Wallet init failed:', (err as Error).message);
    console.log('[Vouch] Server will start but wallet operations may fail');
  }

  // Start monitor
  startRepaymentMonitor();

  // Start autonomous agent loop (runs every 60s)
  startAutonomousLoop();

  // Start server
  app.listen(config.port, () => {
    console.log(`[Vouch] Server running on port ${config.port}`);
    console.log(`[Vouch] Dashboard:  ${config.baseUrl}`);
    console.log(`[Vouch] Apply:      ${config.baseUrl}/apply`);
    console.log(`[Vouch] Explorer:   ${config.baseUrl}/explore`);
    console.log(`[Vouch] Repay:      ${config.baseUrl}/repay`);
    console.log(`[Vouch] API Health: ${config.baseUrl}/api/health`);
  });
}

main().catch((err) => {
  console.error('[Vouch] Fatal startup error:', err);
  process.exit(1);
});
