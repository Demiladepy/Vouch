import axios from 'axios';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

function truncate(addr: string): string {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'unknown';
}

type EventType = 'score' | 'loan_created' | 'loan_disbursed' | 'repayment' | 'default';

const EMOJIS: Record<EventType, string> = {
  score: '🔍',
  loan_created: '📝',
  loan_disbursed: '💸',
  repayment: '✅',
  default: '🚨',
};

export async function sendWebhook(
  event: EventType,
  details: { wallet?: string; amount?: number; score?: number; tier?: string; loanId?: string },
): Promise<void> {
  const emoji = EMOJIS[event] || '📌';
  const wallet = details.wallet ? truncate(details.wallet) : '';
  const lines: string[] = [`${emoji} **Vouch — ${event.replace('_', ' ').toUpperCase()}**`];

  if (wallet) lines.push(`Wallet: \`${wallet}\``);
  if (details.score !== undefined) lines.push(`Score: ${details.score} (${details.tier || 'N/A'})`);
  if (details.amount !== undefined) lines.push(`Amount: ${details.amount} USDT`);
  if (details.loanId) lines.push(`Loan: \`${details.loanId.slice(0, 8)}\``);

  const message = lines.join('\n');

  // Discord
  if (DISCORD_WEBHOOK_URL) {
    try {
      await axios.post(DISCORD_WEBHOOK_URL, { content: message }, { timeout: 5000 });
    } catch (err) {
      console.warn('[Vouch] Discord webhook failed:', (err as Error).message);
    }
  }

  // Telegram
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' },
        { timeout: 5000 },
      );
    } catch (err) {
      console.warn('[Vouch] Telegram webhook failed:', (err as Error).message);
    }
  }

  console.log(`[Vouch] Webhook (${event}): ${wallet || 'system'}`);
}
