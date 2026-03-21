# Vouch: Autonomous Lending Agent (Tether WDK)

**🏆 Hackathon Track:** Lending Bot

Vouch is a fully autonomous, undercollateralized USDT lending agent built on Tether WDK. Once started, Vouch requires zero human intervention to manage its treasury, evaluate borrowers, negotiate loan terms, and collect repayments.

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

## How It Satisfies the Judging Criteria

### Must Have
- ✅ **Decisions without prompts:** Core `runAgentLoop()` checks state and executes decisions autonomously every 60s.
- ✅ **On-Chain Settlement:** Uses Tether WDK (`account.execute`) to process actual USDT transfers gaslessly via ERC-4337.
- ✅ **Autonomous Tracking:** Polling Etherscan for incoming pool wallet transfers to automatically credit borrower repayments.

### Nice to Have
- ✅ **On-Chain History for Credit:** Calculates a 100-point Trust Score based on Etherscan txs, wallet age, and Aave V3 borrow/repay ratios.
- ✅ **LLM Negotiation:** Borrowers can chat with Claude to negotiate loan terms, constrained by their ML risk profile.
- ✅ **Yield Reallocation:** Idle funds are aggregated and deposited into Aave V3 for yield. (Note: Wraps ETH to WETH due to Sepolia USDT supply caps).
- ✅ **Undercollateralized:** Tier system allows up to 1000 USDT at 0% collateral for "Platinum" (high trust score) wallets.

### Bonus / World-First Mechanics
- 🌟 **ML Default Prediction:** Live logistic regression model analyzes borrower profiles to predict default probabilities and dynamic APR bumps.
- 🤝 **Agent-to-Agent Lending:** If Vouch runs low on liquidity but has high-quality borrowers pending, it autonomously negotiates a wholesale loan from an external Liquidity Provider Agent.
- 🔎 **Auditable AI Reason Log:** Every decision the agent makes is logged in SQLite with a generated "Reasoning Trail" from Claude, viewable live on the dashboard.

## Running the Project

### 1. Setup
```bash
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY and WDK_SEED_PHRASE
```

### 2. Live Demo Script (Quickstart for Judges)
Run the automated end-to-end lifecycle demonstration script. This spins up the agent, fakes an application, triggers an ML risk assessment, auto-approves via Claude, and simulates a liquidity crisis to trigger agent-to-agent borrowing.
```bash
npm run demo
```

### 3. Full Web Application
```bash
npm run dev
```
- **Dashboard:** `http://localhost:3001` (View live pool stats and the real-time Agent Activity Feed)
- **Borrower Portal:** `http://localhost:3001/apply` (Enter wallet, chat with LLM to negotiate terms)

## Built With
- `typescript`, `express`, `sql.js` (SQLite engine)
- `node-cron`, `@anthropic-ai/sdk`, `axios`
- `@tetherto/wdk`, `@tetherto/wdk-wallet-evm-erc-4337`, `ethers`
