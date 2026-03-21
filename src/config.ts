import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`[Vouch] Missing required environment variable: ${name}`);
  }
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  groqApiKey: process.env.GROQ_API_KEY || '',
  wdkSeedPhrase: process.env.WDK_SEED_PHRASE || '',
  wdkChain: optional('WDK_CHAIN', 'arbitrum_sepolia'),
  network: optional('NETWORK', 'testnet'),
  etherscanApiKey: optional('ETHERSCAN_API_KEY', ''),
  port: parseInt(optional('PORT', '3001'), 10),
  baseUrl: optional('BASE_URL', 'http://localhost:3001'),
};

if (!config.groqApiKey) {
  console.error('[Config] Missing GROQ_API_KEY in environment variables.');
  process.exit(1);
}
