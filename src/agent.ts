import Groq from 'groq-sdk';
import { config } from './config';
import { TrustScoreResult } from './scorer';

const client = new Groq({ apiKey: config.groqApiKey });

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NegotiationResult {
  agreed: boolean;
  finalAmountUsdt: number;
  finalDays: number;
  finalAprPercent: number;
  finalCollateralPercent: number;
  agentSummary: string;
}

const SYSTEM_PROMPT = `You are Vouch, an AI lending agent that negotiates USDT loan terms with borrowers. You are professional but warm — like a bank manager who actually wants to help.

RULES YOU MUST FOLLOW:
1. You CANNOT exceed the borrower's tier limits (provided in context). Never offer more money, longer duration, or lower collateral than the tier allows.
2. You CAN negotiate within the tier limits:
   - Reduce the loan amount (always allowed)
   - Adjust duration within the tier max (shorter duration = slightly lower APR is fine)
   - You CANNOT remove collateral requirements for Bronze or Silver tiers
3. If the borrower is DECLINED (score below 45), be empathetic but firm. Explain why, give improvement tips. Do NOT offer a loan.
4. Be transparent about your reasoning. Explain how their score AND ML Risk Profile affect their loan terms (especially APR).
5. Keep responses concise — 2-3 paragraphs max.

WHEN A DEAL IS REACHED:
When the borrower agrees to specific terms, output a fenced JSON block tagged with \`\`\`agreement containing:
{
  "agreed": true,
  "finalAmountUsdt": <number>,
  "finalDays": <number>,
  "finalAprPercent": <number>,
  "finalCollateralPercent": <number>,
  "agentSummary": "<one line summary>"
}

Only output this when you have explicit agreement. Do not include the agreement block in your first message — always start by presenting the offer and letting the borrower respond.`;

function buildContext(scoreResult: TrustScoreResult): string {
  const { score, tier, loanTerms, breakdown, improvementTips, mlRiskLevel, mlDefaultProbability } = scoreResult;
  return `[BORROWER CONTEXT — DO NOT SHARE RAW DATA]
Trust Score: ${score}/100
Tier: ${tier}
ML Risk Level: ${mlRiskLevel} (Default Probability: ${mlDefaultProbability ? (mlDefaultProbability * 100).toFixed(1) + '%' : 'N/A'})
Breakdown: Maturity ${breakdown.walletMaturity}/20, DeFi ${breakdown.defiDepth}/20, Repayment ${breakdown.repaymentHistory}/25, Stability ${breakdown.assetStability}/20, Community ${breakdown.communitySignals}/15
Max Offer: ${loanTerms.maxAmountUsdt} USDT for up to ${loanTerms.maxDurationDays} days at ${loanTerms.aprPercent.toFixed(1)}% APR with ${loanTerms.collateralPercent}% collateral
Improvement Tips: ${improvementTips.join('; ') || 'None — excellent profile'}

Begin by greeting the borrower, sharing their tier (not exact score) and ML risk assessment informally, and making your opening offer. If DECLINED, explain why and give improvement tips.`;
}

function extractAgreement(text: string): { agreement: NegotiationResult | null; cleanText: string } {
  const regex = /```agreement\s*\n?([\s\S]*?)\n?```/;
  const match = text.match(regex);

  if (!match) return { agreement: null, cleanText: text };

  try {
    const parsed = JSON.parse(match[1]);
    const agreement: NegotiationResult = {
      agreed: parsed.agreed === true,
      finalAmountUsdt: Number(parsed.finalAmountUsdt),
      finalDays: Number(parsed.finalDays),
      finalAprPercent: Number(parsed.finalAprPercent),
      finalCollateralPercent: Number(parsed.finalCollateralPercent),
      agentSummary: String(parsed.agentSummary || ''),
    };
    const cleanText = text.replace(regex, '').trim();
    return { agreement, cleanText };
  } catch (err) {
    console.warn('[Vouch] Failed to parse agreement JSON:', (err as Error).message);
    return { agreement: null, cleanText: text };
  }
}

export async function startNegotiation(
  scoreResult: TrustScoreResult,
  history: ConversationMessage[],
  newMessage?: string,
): Promise<{
  messages: ConversationMessage[];
  agentReply: string;
  agreement: NegotiationResult | null;
}> {
  const context = buildContext(scoreResult);

  // Build message list for Groq 
  const userMessage = newMessage || ''; // Ensure userMessage is always a string

  // Convert ConversationMessage to Groq format
  const formattedHistory: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext(scoreResult) },
    ...history.map(m => ({ role: m.role, content: m.content } as Groq.Chat.Completions.ChatCompletionMessageParam)),
    { role: 'user', content: userMessage },
  ];

  let agentReply = '';
  let agreement: NegotiationResult | null = null;
  let cleanText = '';

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 400,
      messages: formattedHistory,
    });

    const reply = response.choices[0]?.message?.content || 'I am currently unable to negotiate. Please try again later.';

    const extracted = extractAgreement(reply);
    agreement = extracted.agreement;
    cleanText = extracted.cleanText;

    // If Llama 3 agreed, we can update the agent Summary slightly
    if (agreement) {
      console.log(`[Agent] Negotiation complete for ${scoreResult.address}`);
    }
    agentReply = cleanText;

  } catch (error) {
    console.error('[Vouch] Error during Groq API call:', error);
    agentReply = 'I apologize, but I encountered an error and cannot process your request at this moment. Please try again later.';
    cleanText = agentReply; // Ensure cleanText is also set for history
  }

  // Update history
  const updatedHistory = [...history];
  if (newMessage) {
    updatedHistory.push({ role: 'user', content: newMessage });
  }
  updatedHistory.push({ role: 'assistant', content: cleanText });

  console.log(`[Vouch] Agent replied (${cleanText.length} chars), agreement: ${agreement ? 'YES' : 'no'}`);

  return {
    messages: updatedHistory,
    agentReply: cleanText,
    agreement,
  };
}
