# Vouch: Autonomous Lending Agent (Tether WDK)

**Hackathon Track:** Lending Bot

Vouch is a fully autonomous, undercollateralized USDT lending agent built on **Tether WDK** with **ERC-4337** gasless smart accounts. Once started, Vouch requires zero human intervention to manage its treasury, evaluate borrowers, negotiate loan terms via AI, and collect repayments.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                   VOUCH AUTONOMOUS AGENT                    │
│                                                             │
│  [60s Loop] ──► 1. Evaluate Portfolio & Liquidity           │
│             ──► 2. Score Pending Applications (On-Chain)    │
│             ──► 3. Claude Decision Engine (Approve/Deny)    │
│             ──► 4. Deploy/Withdraw Idle Treasury to Aave V3 │
│             ──► 5. Monitor Repayments via Etherscan         │
│             ──► 6. Escalate / Mark Defaulters               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                 Tether WDK (ERC-4337)
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
  [ Borrowers ]       [ Aave V3 ]      [ LP Agents ]
```

## Pages

| URL | Description |
|---|---|
| `/` | Landing page + admin dashboard with live pool stats & agent activity feed |
| `/apply` | Borrower portal — score, negotiate with AI, receive USDT |
| `/explore` | Score Explorer — paste any wallet, see animated Trust Score |
| `/repay` | Loan management — view active loans, make repayments |

## Trust Score Tiers

| Score | Tier | Max USDT | Duration | APR | Collateral |
|---|---|---|---|---|---|
| 90–100 | PLATINUM | $1,000 | 60 days | 4.5% | 0% |
| 75–89 | GOLD | $500 | 30 days | 6.5% | 10% |
| 60–74 | SILVER | $200 | 14 days | 9.0% | 30% |
| 45–59 | BRONZE | $75 | 7 days | 12.0% | 60% |
| 0–44 | DECLINED | — | — | — | — |

## How It Satisfies the Judging Criteria

### Must Have
- **Decisions without prompts:** Core `runAgentLoop()` checks state and executes decisions autonomously every 60s.
- **On-Chain Settlement:** Uses Tether WDK (`account.execute`) to process actual USDT transfers gaslessly via ERC-4337.
- **Autonomous Tracking:** Polling Etherscan for incoming pool wallet transfers to automatically credit borrower repayments.

### Nice to Have
- **On-Chain History for Credit:** Calculates a 100-point Trust Score based on Etherscan txs, wallet age, and Aave V3 borrow/repay ratios.
- **LLM Negotiation:** Borrowers can chat with Claude to negotiate loan terms, constrained by their ML risk profile.
- **Yield Reallocation:** Idle funds are aggregated and deposited into Aave V3 for yield.
- **Undercollateralized:** Tier system allows up to 1000 USDT at 0% collateral for "Platinum" (high trust score) wallets.

### Bonus / World-First Mechanics
- **ML Default Prediction:** Live logistic regression model analyzes borrower profiles to predict default probabilities and dynamic APR bumps.
- **Agent-to-Agent Lending:** If Vouch runs low on liquidity but has high-quality borrowers pending, it autonomously negotiates a wholesale loan from an external Liquidity Provider Agent.
- **Auditable AI Reason Log:** Every decision the agent makes is logged in SQLite with a generated "Reasoning Trail" from Claude, viewable live on the dashboard.
- **Webhook Notifications:** Loan events (score, disburse, repay, default) push to Discord/Telegram in real time.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Powers the AI loan negotiation agent |
| `WDK_SEED_PHRASE` | Yes | 24-word seed for the pool wallet (ERC-4337) |
| `WDK_CHAIN` | No | Target chain (default: `arbitrum_sepolia`) |
| `ETHERSCAN_API_KEY` | No | Improves Etherscan rate limits |
| `DISCORD_WEBHOOK_URL` | No | Sends loan events to Discord |
| `TELEGRAM_BOT_TOKEN` | No | Sends loan events to Telegram |
| `TELEGRAM_CHAT_ID` | No | Telegram chat for notifications |

## Running the Project

### 1. Setup
```bash
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY and WDK_SEED_PHRASE
```

### 2. Live Demo Script (Quickstart for Judges)
```bash
npm run demo
```

### 3. Seed Demo Data (optional)
```bash
npx ts-node scripts/seed-demo.ts
```

### 4. Full Web Application
```bash
npm run dev
```
- **Dashboard:** `http://localhost:3001`
- **Borrower Portal:** `http://localhost:3001/apply`
- **Score Explorer:** `http://localhost:3001/explore`
- **Repay:** `http://localhost:3001/repay`

## Built With
- `typescript`, `express`, `sql.js` (SQLite engine)
- `node-cron`, `@anthropic-ai/sdk`, `axios`
- `@tetherto/wdk`, `@tetherto/wdk-wallet-evm-erc-4337`, `ethers`
