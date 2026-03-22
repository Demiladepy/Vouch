#  VOUCH — The World's First Fully Autonomous Undercollateralized Lending Agent

> **Zero Human Intervention. On-Chain Settlement. AI-Negotiated Credit. Institutional-Grade Risk.**
> The most sophisticated autonomous lending bot ever deployed on the Tether WDK.

**Live Demo:** https://vouch-lendingg.onrender.com
**GitHub:** https://github.com/Demiladepy/Vouch
**Pool Wallet:** ERC-4337 Smart Account (Arbitrum Sepolia, live USDT operations)

---

##  The One-Line Pitch

Vouch is a fully autonomous AI lending agent that evaluates borrowers on-chain, negotiates loan terms via Claude, disburses USDT gaslessly through ERC-4337 smart accounts, generates yield on idle capital through Aave V3, and collects repayments — all without a single human prompt, ever.

---

## The Problem: DeFi Lending Is Either Broken or Locked Out

Every existing DeFi lending protocol today forces an impossible choice:

| Problem | Current "Solutions" | Why They Fail |
|---|---|---|
|  **Overcollateralization Wall** | Aave, Compound, MakerDAO | You must already have crypto to borrow crypto. This excludes 99% of real-world borrowers. |
| **No Credit Intelligence** | Collateral ratio is the only metric | A wallet holding $10,000 in ETH gets a loan; a wallet with 3 years of spotless DeFi history gets nothing without collateral. |
|  **Human Gatekeepers** | CeFi (Nexo, Celsius) | Requires KYC, centralized approval teams, and trusted custodians — defeating the purpose of DeFi. |
| **Capital Inefficiency** | Idle treasury pools | Lending protocols leave massive capital uninvested during low-demand periods. |
|  **No Negotiation** | Static rate tables | Borrowers get take-it-or-leave-it terms with no ability to discuss, negotiate, or appeal. |

**Vouch eliminates all five problems simultaneously.** It replaces the human underwriter, the collateral wall, the static rate table, and the idle treasury — with a single, always-on autonomous agent.

---

##  The Solution: Vouch = The Autonomous Central Bank of DeFi Credit

Vouch is not a lending UI. It is **autonomous lending infrastructure** — a fully deployed, event-driven AI oracle that:

-  **Scores** any wallet's on-chain creditworthiness in real-time using a 100-point Trust Score engine
-  **Negotiates** loan terms conversationally via Claude AI, constrained by ML risk profiles
-  **Disburses** gasless USDT via Tether WDK ERC-4337 smart accounts the moment approval is reached
-  **Generates yield** by deploying idle treasury capital to Aave V3 autonomously
-  **Tracks repayments** by polling Etherscan and auto-crediting the borrower's account
-  **Enforces defaults** by escalating overdue loans and updating credit scores on-chain

**No loan officer. No form submissions. No human reviews. No gas fees.**

---

##  Dashboard & Interface

### Admin Dashboard — Live Pool Intelligence

![Vouch Admin Dashboard](https://raw.githubusercontent.com/Demiladepy/Vouch/main/Screenshot%20(2960).png)

The Vouch dashboard provides real-time visibility into every dimension of the autonomous agent's operations: treasury health, active loan portfolio, agent decision log, and Aave V3 yield positions — all streaming live.

### Borrower Application Portal — AI-Negotiated Terms

![Borrower Portal](https://raw.githubusercontent.com/Demiladepy/Vouch/main/Screenshot%20(2961).png)

Borrowers interact with the Claude-powered negotiation agent to discuss, adjust, and finalize their loan terms — within hard limits set by their Trust Score tier. This is the world's first conversational credit underwriting experience.

### Score Explorer — Real-Time Wallet Intelligence

![Score Explorer](https://raw.githubusercontent.com/Demiladepy/Vouch/main/Screenshot%20(2962).png)

Paste any EVM wallet address and watch Vouch's Trust Score engine fire in real-time — pulling Etherscan transaction history, Aave V3 borrow/repay ratios, wallet age, and activity patterns to produce an animated, auditable credit score.

### Loan Repayment Portal

![Repayment Portal](https://raw.githubusercontent.com/Demiladepy/Vouch/main/Screenshot%20(2963).png)

Active borrowers manage their loans, track due dates, and submit repayments — all reflected instantly in the agent's autonomous monitoring loop.

---

##  System Architecture

### High-Level Agent Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        VOUCH AUTONOMOUS AGENT                            │
│                         [ Runs Every 60 Seconds ]                        │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  STEP 1 — Portfolio Evaluation                                   │   │
│   │  • Check treasury balance & utilization rate                     │   │
│   │  • Calculate available lending capacity                          │   │
│   │  • Assess Aave V3 yield positions                                │   │
│   └───────────────────────────┬─────────────────────────────────────┘   │
│                               │                                          │
│   ┌───────────────────────────▼─────────────────────────────────────┐   │
│   │  STEP 2 — Application Scoring (On-Chain)                         │   │
│   │  • Pull pending applications from SQLite queue                   │   │
│   │  • Fetch Etherscan tx history for each wallet                    │   │
│   │  • Compute 100-point Trust Score (ML + heuristics)               │   │
│   │  • Run logistic regression default prediction model              │   │
│   └───────────────────────────┬─────────────────────────────────────┘   │
│                               │                                          │
│   ┌───────────────────────────▼─────────────────────────────────────┐   │
│   │  STEP 3 — Claude Decision Engine                                 │   │
│   │  • Pass score + portfolio state + risk model to Claude           │   │
│   │  • Claude returns: APPROVE / DENY / COUNTER-OFFER                │   │
│   │  • Generate human-readable "Reasoning Trail" for audit log       │   │
│   │  • Store decision + reasoning in SQLite                          │   │
│   └───────────────────────────┬─────────────────────────────────────┘   │
│                               │                                          │
│   ┌───────────────────────────▼─────────────────────────────────────┐   │
│   │  STEP 4 — Treasury Optimization (Aave V3)                        │   │
│   │  • If utilization < 70%: deploy idle USDT to Aave V3             │   │
│   │  • If loan approved & liquidity needed: withdraw from Aave V3    │   │
│   │  • If liquidity critically low: trigger LP Agent negotiation     │   │
│   └───────────────────────────┬─────────────────────────────────────┘   │
│                               │                                          │
│   ┌───────────────────────────▼─────────────────────────────────────┐   │
│   │  STEP 5 — Repayment Monitoring                                   │   │
│   │  • Poll Etherscan for incoming transfers to pool wallet          │   │
│   │  • Match amounts to active loan records                          │   │
│   │  • Auto-credit borrower accounts on match                        │   │
│   │  • Update Trust Score on successful repayment                    │   │
│   └───────────────────────────┬─────────────────────────────────────┘   │
│                               │                                          │
│   ┌───────────────────────────▼─────────────────────────────────────┐   │
│   │  STEP 6 — Default Escalation                                     │   │
│   │  • Identify loans past due date with no repayment                │   │
│   │  • Mark as DEFAULT in ledger                                     │   │
│   │  • Reduce borrower Trust Score                                   │   │
│   │  • Push alert to Discord / Telegram webhook                      │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                       Tether WDK (ERC-4337)
                    Gasless USDT Execution Layer
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   [ Borrowers ]             [ Aave V3 ]          [ LP Agents ]
   USDT disbursed         Yield generation      Wholesale funding
   gaslessly via         on idle capital        when pool is low
   smart account
```

---

### Data & Decision Flow

```
  Borrower submits          Etherscan API            Aave V3 Protocol
  wallet address    ──►   tx history fetch   ──►   borrow/repay ratio
         │                      │                        │
         └──────────────────────┴────────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   TRUST SCORE ENGINE   │
                    │  ─────────────────── │
                    │  Wallet Age      20pts │
                    │  TX Volume       20pts │
                    │  Repay History   25pts │
                    │  Aave Health     20pts │
                    │  ML Risk Model   15pts │
                    │  ─────────────────── │
                    │  Total:      0–100 pts │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │  CLAUDE DECISION ENGINE │
                    │  ─────────────────────│
                    │  Input: Score +        │
                    │  Portfolio State +     │
                    │  ML Default Prob       │
                    │                       │
                    │  Output:              │
                    │  ✅ APPROVE           │
                    │  ❌ DENY             │
                    │  🔄 COUNTER-OFFER    │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   TETHER WDK ERC-4337  │
                    │   account.execute()    │
                    │   Gasless USDT send    │
                    └────────────────────────┘
```

---

### Agent-to-Agent Liquidity Architecture (World-First)

```
  ┌─────────────────────────────────────────────────────┐
  │              VOUCH PRIMARY AGENT                    │
  │                                                     │
  │  Pool Utilization > 90% AND                        │
  │  High-Quality Borrowers Pending                     │
  │           │                                         │
  │           ▼                                         │
  │   Initiate A2A Negotiation Protocol                 │
  └─────────────────────┬───────────────────────────────┘
                        │  Autonomous API call
                        ▼
  ┌─────────────────────────────────────────────────────┐
  │            EXTERNAL LP AGENT                        │
  │                                                     │
  │  • Receives Vouch's borrower quality metrics        │
  │  • Evaluates wholesale lending terms                │
  │  • Returns: rate, amount, duration                  │
  │                                                     │
  └─────────────────────┬───────────────────────────────┘
                        │  Wholesale USDT transfer
                        ▼
  ┌─────────────────────────────────────────────────────┐
  │            VOUCH TREASURY REPLENISHED               │
  │                                                     │
  │  Resumes lending to pending borrowers               │
  │  LP Agent repaid from collected interest            │
  └─────────────────────────────────────────────────────┘
```

---

##  The 5-Layer Autonomy Stack

### Layer 1 — Perception (60-Second Oracle Loop)

Vouch's `runAgentLoop()` fires every 60 seconds via `node-cron` and performs a complete state sweep:

- Scans all pending loan applications from the SQLite queue
- Polls Etherscan for new inbound transactions to the pool wallet address
- Checks active loan due dates against current timestamp
- Reads current Aave V3 position APY and balance
- Reads treasury USDT balance via Tether WDK

No external trigger. No human action. Pure event-driven autonomy.

---

### Layer 2 — Scoring (100-Point Trust Score Engine)

The Trust Score is computed from **5 weighted on-chain signals**:

| Signal | Weight | Data Source | What It Measures |
|---|---|---|---|
|  Wallet Age | 20 pts | Etherscan first tx | Account maturity & seriousness |
| Transaction Volume | 20 pts | Etherscan tx count | DeFi participation depth |
|  Repayment History | 25 pts | Etherscan incoming txs | Historical debt service behavior |
|  Aave Health Factor | 20 pts | Aave V3 subgraph | Active DeFi creditworthiness |
| ML Default Prediction | 15 pts | Logistic regression model | Forward-looking default probability |

The ML model ingests all 4 prior signals and outputs a **dynamic APR bump** — meaning higher-risk borrowers within a tier pay more, rewarding genuinely creditworthy wallets with better rates.

---

### Layer 3 — Decision (Trust Score Tier System)

| Score | Tier | Max USDT | Duration | APR | Collateral | Who Qualifies |
|---|---|---|---|---|---|---|
| 90–100 | 🥇 PLATINUM | $1,000 | 60 days | 4.5% | **0%** | Established DeFi power users with pristine history |
| 75–89 | 🥈 GOLD | $500 | 30 days | 6.5% | 10% | Active participants with solid repayment track record |
| 60–74 | 🥉 SILVER | $200 | 14 days | 9.0% | 30% | Emerging DeFi participants with moderate history |
| 45–59 | 🟫 BRONZE | $75 | 7 days | 12.0% | 60% | New wallets or limited history — small starter loans |
| 0–44 | ⛔ DECLINED | — | — | — | — | Insufficient history or predicted default risk too high |

**Every tier is fully autonomous** — no human touches the approval pipeline. Claude generates a written reasoning trail for every single decision, logged immutably to SQLite.

---

### Layer 4 — AI Negotiation (Claude-Powered Loan Desk)

Once scored, borrowers enter a **live conversation with Claude** on the `/apply` page. The negotiation agent is constrained by hard limits derived from the Trust Score but can:

- Explain why the borrower received their score
- Offer to adjust loan amount, duration, or collateral within tier limits
- Answer questions about repayment terms, APR calculation, and default consequences
- Provide a final term sheet that the borrower accepts before WDK execution

This is the **world's first conversational DeFi loan desk** — AI underwriting with a human conversational layer.

---

### Layer 5 — Execution (Tether WDK ERC-4337)

```typescript
// src/agent/loanEngine.ts — The entire settlement engine

import { WDK } from '@tetherto/wdk';
import { ERC4337Wallet } from '@tetherto/wdk-wallet-evm-erc-4337';

const account = new ERC4337Wallet({
  seedPhrase: config.WDK_SEED_PHRASE,
  chain: config.WDK_CHAIN  // arbitrum_sepolia
});

// Called autonomously by agent when Claude returns APPROVE
export const disburseLoan = async (borrowerAddress: string, amountUsdt: number) => {
  const txHash = await account.execute(borrowerAddress, amountUsdt);
  await logDecision(borrowerAddress, 'DISBURSED', txHash);
  await notifyWebhooks('loan_disbursed', { borrower: borrowerAddress, amount: amountUsdt, txHash });
  return txHash;
};
```

No ethers.js wrapper. No Web3.js abstraction. **The Tether WDK IS the financial engine.** ERC-4337 means every loan disbursement is gasless — borrowers never need ETH to receive USDT.

---

## 💰 Economic Soundness: Institutional-Grade Treasury Management

Vouch doesn't passively hold funds. Every dollar in the pool is either **earning yield** or **earning interest** — there is no idle capital.

### Capital Allocation State Machine

```
                  ┌─────────────────────────┐
                  │     POOL TREASURY        │
                  └────────────┬────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  ACTIVE LOANS│  │  AAVE V3     │  │  LIQUID      │
    │              │  │  YIELD POS.  │  │  RESERVE     │
    │  Earning APR │  │  Earning APY │  │  ≥10% buffer │
    │  from borr.  │  │  on idle $   │  │  for exits   │
    └──────────────┘  └──────────────┘  └──────────────┘
         ▲                   ▲                  │
         │                   │                  │
         └───────────────────┴──────────────────┘
                Agent rebalances every 60s
```

### Safety Mechanisms

| Mechanism | How It Works | What It Prevents |
|---|---|---|
| **Utilization Cap** | Agent never lends > 90% of treasury | Treasury drain & liquidity crisis |
| **Aave Auto-Deploy** | Idle capital (>10% undeployed) moves to Aave V3 | Zero idle capital drag |
| **Aave Auto-Withdraw** | Agent pulls from Aave before disbursing approved loans | Gas-efficient capital recycling |
| **ML Default Filter** | Loans with predicted default probability >40% are denied regardless of tier | Portfolio quality protection |
| **A2A Liquidity Bridge** | Agent autonomously negotiates wholesale loans from LP agents when utilization hits 90% | Prevents borrower rejection during peak demand |
| **Immutable Audit Log** | Every decision logged in SQLite with Claude reasoning trail | Full regulatory auditability |
| **Webhook Alerting** | Discord/Telegram receives every loan event in real-time | Instant human oversight when needed |

---

## 🏆 World-First Mechanics

| Innovation | Why It Has Never Been Done Before |
|---|---|
| 🥇 **First Undercollateralized DeFi Lending Agent** | No prior system autonomously undercuts collateral requirements using real on-chain credit scoring — without KYC, without a human underwriter, without a centralized risk team |
| 🥇 **First Agent-to-Agent DeFi Liquidity Protocol** | When Vouch's pool runs low, it autonomously contacts an external LP Agent, negotiates wholesale terms, and draws a bridge loan — the first ever A2A DeFi capital market |
| 🥇 **First Conversational Loan Desk on DeFi** | Borrowers negotiate loan terms with Claude in natural language — the AI is constrained by ML risk profiles, making every conversation financially responsible while feeling human |
| 🥇 **First Auditable AI Reasoning Trail in Lending** | Every single credit decision — approve, deny, or counter-offer — is logged with a full Claude-generated reasoning trail in SQLite, viewable live. Regulators can audit every decision Vouch ever made |
| 🥇 **First DeFi Lending Agent with ML Default Prediction** | A live logistic regression model continuously recalibrates APR based on predicted default probability — not just tier membership. Higher-risk borrowers pay more; pristine wallets get better rates |

---

## ✅ Judging Criteria: Full Alignment

### Must-Have Requirements

| Requirement | How Vouch Delivers |
|---|---|
| ✅ **Decisions without prompts** | `runAgentLoop()` runs every 60 seconds via `node-cron`. It evaluates the portfolio, scores applications, approves or denies loans, rebalances to Aave, and checks for defaults — completely without human input. This is not simulated autonomy; it is running in production. |
| ✅ **On-Chain Settlement** | `account.execute()` via the Tether WDK ERC-4337 smart account processes all USDT transfers gaslessly. Loan disbursements and collateral handling are real on-chain transactions on Arbitrum Sepolia. |
| ✅ **Autonomous Tracking** | Etherscan is polled every 60 seconds for incoming transfers to the pool wallet. Pattern matching against active loan records automatically credits repayments — no b
