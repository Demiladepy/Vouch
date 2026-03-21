/**
 * Agent-to-Agent Lending Market
 * 
 * World First: Autonomous agents negotiating wholesale liquidity from competing LP agents.
 * When Vouch's pool liquidity runs low, it requests capital from a marketplace of 3 LP agents,
 * each with different risk appetites. Vouch autonomously picks the best offer.
 * 
 * Upgrade: Agent Debt Servicing — Vouch tracks its wholesale debt and repays it from revenue.
 */

import Groq from 'groq-sdk';
import { getPoolStats } from './loans';
import { logDecision } from './autonomous';
import { config } from './config';

const client = new Groq({ apiKey: config.groqApiKey });

// ─── AGENT DEBT STATE ────────────────────────────────────────────────────────
let agentDebtUsdt = 0;
let totalRevenueEarned = 0;

export function getAgentDebt(): number { return agentDebtUsdt; }
export function recordRevenue(amount: number): void { totalRevenueEarned += amount; }

export async function serviceDebt(availableLiquidity: number): Promise<number> {
  if (agentDebtUsdt <= 0 || availableLiquidity < agentDebtUsdt) return 0;
  const paid = agentDebtUsdt;
  agentDebtUsdt = 0;
  logDecision({
    action_type: 'SERVICE_DEBT',
    confidence: 1.0,
    reasoning: `Agent autonomously repaid $${paid.toFixed(2)} wholesale debt from $${totalRevenueEarned.toFixed(2)} earned revenue. Debt fully extinguished.`,
    result: 'Repaid',
    amount_usdt: paid,
  });
  console.log(`[Agent Market] ✅ Debt service complete: $${paid.toFixed(2)} repaid from treasury.`);
  return paid;
}

// ─── SIMULATED LP AGENTS ─────────────────────────────────────────────────────
const LP_AGENTS = [
  {
    name: 'AlphaYield Capital',
    persona: 'Conservative LP. Prioritizes capital safety. Requires default rate < 5%. Offers 2-3% APR.',
    minScore: 70, maxDefaultRate: 5, aprRange: [2, 3],
  },
  {
    name: 'Nexus Liquidity',
    persona: 'Balanced LP. Moderate risk tolerance. Accepts default rate < 10%. Offers 3-5% APR.',
    minScore: 50, maxDefaultRate: 10, aprRange: [3, 5],
  },
  {
    name: 'DeltaFlow Protocol',
    persona: 'Aggressive LP. High-yield seeking. Accepts default rate < 15%. Offers 5-8% APR.',
    minScore: 40, maxDefaultRate: 15, aprRange: [5, 8],
  },
];

// ─── WHOLESALE LIQUIDITY NEGOTIATION ─────────────────────────────────────────
async function negotiateWithLpAgent(
  agent: typeof LP_AGENTS[0],
  requestAmount: number,
  stats: ReturnType<typeof getPoolStats>,
): Promise<{ approved: boolean; amount_usdt?: number; apr_percent?: number; reasoning: string }> {
  const prompt = `You are ${agent.name}, an autonomous Liquidity Provider Agent.
Your persona: ${agent.persona}

Vouch Lending Pool is requesting ${requestAmount} USDT wholesale liquidity.
Pool Stats:
- Active Loans: ${stats.activeLoans}
- Total Loaned: ${stats.totalLoanedOut} USDT
- Default Rate: ${stats.defaultRate}%
- Avg Borrower Trust Score: ${stats.avgTrustScore}/100

Based on your persona and risk parameters, decide whether to approve this loan request.
Output ONLY valid JSON, no markdown:
{
  "approved": boolean,
  "amount_usdt": number,
  "apr_percent": number,
  "reasoning": "1 sentence explanation"
}`;

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 200,
      messages: [
        { role: 'system', content: `You are ${agent.name}. Respond ONLY in valid JSON.` },
        { role: 'user', content: prompt },
      ],
    });

    const raw = response.choices[0]?.message?.content || '';
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { approved: false, reasoning: `${agent.name} communication failed.` };
  }
}

// ─── MANAGE WHOLESALE LIQUIDITY ───────────────────────────────────────────────
export async function manageWholesaleLiquidity(unallocatedUsdt: number): Promise<void> {
  if (unallocatedUsdt >= 500) return;

  const stats = getPoolStats();
  if (stats.defaultRate >= 15) return; // Don't borrow if pool is too risky

  const requestAmount = 1000;

  logDecision({
    action_type: 'AGENT_BORROW_REQUEST',
    confidence: 0.85,
    reasoning: `Pool liquidity is critically low ($${unallocatedUsdt.toFixed(2)}). Pool health: ${stats.defaultRate.toFixed(1)}% default rate. Broadcasting request to ${LP_AGENTS.length} competing LP agents for best rate.`,
    result: 'Pending',
  });

  console.log(`[Agent Market] Requesting $${requestAmount} from ${LP_AGENTS.length} competing LP Agents...`);

  // Query all LP agents in parallel — true agent marketplace!
  const offers = await Promise.all(
    LP_AGENTS.map(async (agent) => {
      const offer = await negotiateWithLpAgent(agent, requestAmount, stats);
      return { agent: agent.name, ...offer };
    })
  );

  const approvedOffers = offers.filter(o => o.approved && o.apr_percent != null);

  if (approvedOffers.length > 0) {
    // Pick best (lowest APR) offer autonomously
    const best = approvedOffers.sort((a, b) => (a.apr_percent || 99) - (b.apr_percent || 99))[0];

    agentDebtUsdt += requestAmount; // Record debt

    logDecision({
      action_type: 'AGENT_BORROW_APPROVED',
      confidence: 1.0,
      reasoning: `Best offer won by ${best.agent} at ${best.apr_percent}% APR from ${approvedOffers.length} bids. Ingested $${requestAmount} wholesale liquidity. Debt: $${agentDebtUsdt.toFixed(2)}.`,
      result: 'Funded',
      amount_usdt: requestAmount,
    });
    console.log(`[Agent Market] ✅ WON: ${best.agent} at ${best.apr_percent}% APR. Debt: $${agentDebtUsdt.toFixed(2)}`);
  } else {
    logDecision({
      action_type: 'AGENT_BORROW_DENIED',
      confidence: 1.0,
      reasoning: `All ${LP_AGENTS.length} LP agents denied the wholesale request. Pool risk metrics did not meet their thresholds.`,
      result: 'Denied',
    });
    console.log(`[Agent Market] ❌ All LP agents denied. Pool risk too high.`);
  }
}
