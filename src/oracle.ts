/**
 * On-Chain Price Oracle
 * Fetches live ETH/USDT price to compute real-time collateral valuations.
 * In production, this would use Chainlink or Pyth Network.
 */

import axios from 'axios';

let cachedEthPrice: number = 3000; // Default fallback
let lastFetchTime: number = 0;
const CACHE_TTL_MS = 60_000; // Refresh every 60 seconds

export async function getEthUsdtPrice(): Promise<number> {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_TTL_MS) return cachedEthPrice;

  try {
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { timeout: 5000 }
    );
    const price = res.data?.ethereum?.usd;
    if (price && typeof price === 'number') {
      cachedEthPrice = price;
      lastFetchTime = now;
      console.log(`[Oracle] ETH/USD price updated: $${price}`);
    }
  } catch {
    // Silently use cached price if fetch fails
  }
  return cachedEthPrice;
}

export function formatUsdValue(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
