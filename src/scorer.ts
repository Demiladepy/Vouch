import axios from 'axios';
import { ethers } from 'ethers';
import { config } from './config';
import crypto from 'crypto';

// --- Types ---

interface ScoreBreakdown {
  walletMaturity: number;
  defiDepth: number;
  repaymentHistory: number;
  assetStability: number;
  communitySignals: number;
}

interface LoanTerms {
  maxAmountUsdt: number;
  maxDurationDays: number;
  aprPercent: number;
  collateralPercent: number;
}

export interface TrustScoreResult {
  address: string;
  score: number;
  tier: string;
  did: string;          // Decentralized Identifier for this credit profile
  loanTerms: LoanTerms;
  breakdown: ScoreBreakdown;
  explanation: string[];
  improvementTips: string[];
  mlRiskLevel?: string;
  mlDefaultProbability?: number;
}

// --- Tier config ---

const TIERS: Record<string, LoanTerms & { minScore: number }> = {
  PLATINUM: { minScore: 90, maxAmountUsdt: 1000, maxDurationDays: 60, aprPercent: 4.5, collateralPercent: 0 },
  GOLD:     { minScore: 75, maxAmountUsdt: 500,  maxDurationDays: 30, aprPercent: 6.5, collateralPercent: 10 },
  SILVER:   { minScore: 60, maxAmountUsdt: 200,  maxDurationDays: 14, aprPercent: 9.0, collateralPercent: 30 },
  BRONZE:   { minScore: 45, maxAmountUsdt: 75,   maxDurationDays: 7,  aprPercent: 12.0, collateralPercent: 60 },
  DECLINED: { minScore: 0,  maxAmountUsdt: 0,    maxDurationDays: 0,  aprPercent: 0,   collateralPercent: 0 },
};

function getTier(score: number): { tier: string; terms: LoanTerms } {
  for (const [name, t] of Object.entries(TIERS)) {
    if (score >= t.minScore) {
      return {
        tier: name,
        terms: {
          maxAmountUsdt: t.maxAmountUsdt,
          maxDurationDays: t.maxDurationDays,
          aprPercent: t.aprPercent,
          collateralPercent: t.collateralPercent,
        },
      };
    }
  }
  return { tier: 'DECLINED', terms: TIERS.DECLINED };
}

// --- Data fetchers ---
import { evaluateLoanRisk, MLFeatures } from './ml-scorer';

interface EtherscanTx {
  timeStamp: string;
  to: string;
  from: string;
}

async function fetchEtherscanData(address: string): Promise<{
  txCount: number;
  walletAgeDays: number;
  uniqueContracts: number;
  lastActivityDays: number;
}> {
  const baseUrl = 'https://api.arbiscan.io/api';
  const apiKeyParam = config.etherscanApiKey ? `&apikey=${config.etherscanApiKey}` : '';

  const url = `${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc${apiKeyParam}`;
  const resp = await axios.get(url, { timeout: 10000 });

  if (resp.data.status !== '1' || !Array.isArray(resp.data.result)) {
    // Try Sepolia Arbiscan
    const sepoliaUrl = `https://api-sepolia.arbiscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc${apiKeyParam}`;
    const sepoliaResp = await axios.get(sepoliaUrl, { timeout: 10000 });
    if (sepoliaResp.data.status !== '1' || !Array.isArray(sepoliaResp.data.result)) {
      return { txCount: 0, walletAgeDays: 0, uniqueContracts: 0, lastActivityDays: 999 };
    }
    return parseTxList(sepoliaResp.data.result);
  }

  return parseTxList(resp.data.result);
}

function parseTxList(txs: EtherscanTx[]): {
  txCount: number;
  walletAgeDays: number;
  uniqueContracts: number;
  lastActivityDays: number;
} {
  if (txs.length === 0) {
    return { txCount: 0, walletAgeDays: 0, uniqueContracts: 0, lastActivityDays: 999 };
  }

  const now = Date.now() / 1000;
  const firstTs = parseInt(txs[0].timeStamp, 10);
  const lastTs = parseInt(txs[txs.length - 1].timeStamp, 10);
  const walletAgeDays = Math.floor((now - firstTs) / 86400);
  const lastActivityDays = Math.floor((now - lastTs) / 86400);

  const contracts = new Set<string>();
  for (const tx of txs) {
    if (tx.to) contracts.add(tx.to.toLowerCase());
  }

  return {
    txCount: txs.length,
    walletAgeDays,
    uniqueContracts: contracts.size,
    lastActivityDays,
  };
}

interface AaveData {
  totalBorrows: number;
  totalRepays: number;
  liquidations: number;
}

async function fetchAaveData(address: string): Promise<AaveData> {
  const subgraphUrl = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-arbitrum';
  const query = `{
    borrows(where: { user: "${address.toLowerCase()}" }, first: 100) { id }
    repays(where: { user: "${address.toLowerCase()}" }, first: 100) { id }
    liquidationCalls(where: { user: "${address.toLowerCase()}" }, first: 10) { id }
  }`;

  const resp = await axios.post(subgraphUrl, { query }, { timeout: 10000 });
  const data = resp.data?.data;
  if (!data) return { totalBorrows: 0, totalRepays: 0, liquidations: 0 };

  return {
    totalBorrows: data.borrows?.length ?? 0,
    totalRepays: data.repays?.length ?? 0,
    liquidations: data.liquidationCalls?.length ?? 0,
  };
}

async function checkEns(address: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider('https://cloudflare-eth.com');
    const name = await provider.lookupAddress(address);
    return !!name;
  } catch {
    return false;
  }
}

async function fetchUsdtBalance(address: string): Promise<number> {
  try {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const usdt = new ethers.Contract(
      '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      ['function balanceOf(address) view returns (uint256)'],
      provider,
    );
    const bal: bigint = await usdt.balanceOf(address);
    return Number(bal) / 1e6;
  } catch {
    return 0;
  }
}

// --- Scoring ---

function scoreWalletMaturity(ageDays: number): { score: number; explanation: string } {
  const years = ageDays / 365;
  let score: number;
  if (years >= 3) score = 20;
  else if (years >= 2) score = 16;
  else if (years >= 1) score = 12;
  else if (ageDays >= 180) score = 8;
  else if (ageDays >= 30) score = 4;
  else score = 1;

  return { score, explanation: `Wallet age: ${ageDays} days (${years.toFixed(1)} years) → ${score}/20` };
}

function scoreDefiDepth(txCount: number, uniqueContracts: number): { score: number; explanation: string } {
  const txPart = Math.min(10, Math.floor(txCount / 100));
  const protoPart = Math.min(10, uniqueContracts);
  const score = txPart + protoPart;
  return { score, explanation: `${txCount} txs (${txPart}/10) + ${uniqueContracts} unique contracts (${protoPart}/10) → ${score}/20` };
}

function scoreRepayment(aave: AaveData): { score: number; explanation: string } {
  if (aave.liquidations > 0) {
    return { score: 0, explanation: `Liquidation detected — repayment score: 0/25` };
  }
  if (aave.totalBorrows === 0) {
    return { score: 10, explanation: `No borrow history — baseline: 10/25` };
  }
  const repayRate = aave.totalRepays / aave.totalBorrows;
  const score = Math.max(0, Math.round(repayRate * 25));
  return { score, explanation: `${aave.totalRepays}/${aave.totalBorrows} repay rate (${(repayRate * 100).toFixed(0)}%) → ${score}/25` };
}

function scoreAssetStability(usdtBalance: number, lastActivityDays: number): { score: number; explanation: string } {
  let score: number;
  if (usdtBalance >= 1000) score = 20;
  else if (usdtBalance >= 500) score = 16;
  else if (usdtBalance >= 100) score = 12;
  else if (usdtBalance >= 50) score = 8;
  else if (usdtBalance >= 10) score = 4;
  else score = 1;

  if (lastActivityDays > 90) {
    score = Math.max(0, score - 5);
  }

  return { score, explanation: `USDT balance: $${usdtBalance.toFixed(2)} → ${score}/20${lastActivityDays > 90 ? ' (inactive penalty -5)' : ''}` };
}

function scoreCommunity(hasEns: boolean, txCount: number): { score: number; explanation: string } {
  let score = 0;
  const parts: string[] = [];
  if (hasEns) { score += 8; parts.push('ENS +8'); }
  if (txCount > 500) { score += 3; parts.push('500+ txs +3'); }
  // Governance votes would require additional subgraph query — skip for demo, give partial credit for high tx count
  if (txCount > 200) { score += 4; parts.push('active user +4'); }
  score = Math.min(15, score);
  return { score, explanation: `Community signals: ${parts.join(', ') || 'none'} → ${score}/15` };
}

// --- Main export ---

export async function scoreWallet(address: string): Promise<TrustScoreResult> {
  console.log(`[Vouch] Scoring wallet: ${address}`);

  // Fetch all data in parallel, never crash
  const [etherscanResult, aaveResult, ensResult, balanceResult] = await Promise.allSettled([
    fetchEtherscanData(address),
    fetchAaveData(address),
    checkEns(address),
    fetchUsdtBalance(address),
  ]);

  const etherscan = etherscanResult.status === 'fulfilled'
    ? etherscanResult.value
    : { txCount: 0, walletAgeDays: 0, uniqueContracts: 0, lastActivityDays: 999 };

  const aave = aaveResult.status === 'fulfilled'
    ? aaveResult.value
    : { totalBorrows: 0, totalRepays: 0, liquidations: 0 };

  const hasEns = ensResult.status === 'fulfilled' ? ensResult.value : false;
  const usdtBalance = balanceResult.status === 'fulfilled' ? balanceResult.value : 0;

  if (etherscanResult.status === 'rejected') {
    console.warn('[Vouch] Etherscan fetch failed:', etherscanResult.reason);
  }
  if (aaveResult.status === 'rejected') {
    console.warn('[Vouch] Aave fetch failed:', aaveResult.reason);
  }

  // Calculate each category
  const maturity = scoreWalletMaturity(etherscan.walletAgeDays);
  const depth = scoreDefiDepth(etherscan.txCount, etherscan.uniqueContracts);
  const repayment = scoreRepayment(aave);
  const stability = scoreAssetStability(usdtBalance, etherscan.lastActivityDays);
  const community = scoreCommunity(hasEns, etherscan.txCount);

  const breakdown: ScoreBreakdown = {
    walletMaturity: maturity.score,
    defiDepth: depth.score,
    repaymentHistory: repayment.score,
    assetStability: stability.score,
    communitySignals: community.score,
  };

  const score = Math.min(100, maturity.score + depth.score + repayment.score + stability.score + community.score);
  const explanation = [maturity.explanation, depth.explanation, repayment.explanation, stability.explanation, community.explanation];

  const { tier, terms } = getTier(score);

  // Calculate ML Default Risk
  const mlFeatures: MLFeatures = {
     trustScore: score,
     loanAmount: terms.maxAmountUsdt,
     walletAgeDays: etherscan.walletAgeDays,
     defiDepth: etherscan.txCount + etherscan.uniqueContracts,
     repaymentRate: aave.totalBorrows > 0 ? aave.totalRepays / aave.totalBorrows : 1.0,
     liquidityRatio: usdtBalance > 0 && terms.maxAmountUsdt > 0 ? usdtBalance / terms.maxAmountUsdt : 1.0
  };
  const mlRisk = evaluateLoanRisk(mlFeatures);

  // Apply APR bump from ML model
  terms.aprPercent += mlRisk.suggestedAprBump;

  // Improvement tips for lower scores
  const improvementTips: string[] = [];
  if (maturity.score < 12) improvementTips.push('Keep your wallet active — age and consistency build trust.');
  if (depth.score < 10) improvementTips.push('Interact with more DeFi protocols to show on-chain experience.');
  if (repayment.score < 15) improvementTips.push('Build a repayment track record on Aave or Compound.');
  if (stability.score < 12) improvementTips.push('Hold stablecoins to demonstrate financial stability.');
  if (!hasEns) improvementTips.push('Register an ENS name to strengthen your on-chain identity.');
  if (tier === 'DECLINED') improvementTips.push('Your wallet needs more on-chain history before qualifying. Try transacting on DeFi protocols and maintaining balances.');

  // Generate DID (EIP-725 style) — deterministic from address + trust score + circuit version
  const didPayload = `${address}:${score}:vouch-credit-v1`;
  const did = `did:vouch:${crypto.createHash('sha256').update(didPayload).digest('hex').substring(0, 32)}`;

  console.log(`[Vouch] Score for ${address}: ${score} (${tier}) | DID: ${did}`);

  return {
    address,
    score,
    tier,
    did,
    loanTerms: terms,
    breakdown,
    explanation,
    improvementTips,
    mlRiskLevel: mlRisk.riskLevel,
    mlDefaultProbability: mlRisk.probabilityOfDefault,
  };
}
