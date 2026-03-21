import { ethers } from 'ethers';
import { getWallet } from './wdk';

const ARBITRUM_SEPOLIA_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';

// Aave V3 Pool on Arbitrum Sepolia (testnet deployment)
const AAVE_POOL_ADDRESS = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'; // Aave V3 Pool proxy
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WETH_ADDRESS = '0x980b62da83eff3d4576c647993b0c1d7faf17c73'; // WETH on Arbitrum Sepolia
const AWETH_ADDRESS = '0x17caa19d443f55a7b39ec79f3bef4689e8b6bc16'; // aArbSepWETH

const POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function withdraw(uint256 wad)',
];

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
}

export async function depositIdleFunds(amount: number): Promise<string> {
  try {
    console.log(`[Vouch] Depositing ${amount} USDT equivalent in WETH to Aave V3 for yield`);

    const wallet = await getWallet();
    const address = await wallet.getAddress();
    const provider = getProvider();

    // Since USDT has a supply cap issue on Sepolia, we wrap ETH to WETH and supply that instead
    // First, convert the USDT amount intention to an ETH equivalent (assuming 1 ETH = $3000 for demo)
    const ethAmount = amount / 3000;
    const ethAmountWei = ethers.parseEther(ethAmount.toString());

    // 1. Wrap ETH to WETH
    console.log(`[Vouch] Wrapping ${ethAmount} ETH to WETH`);
    const wethIface = new ethers.Interface(WETH_ABI);
    const depositData = wethIface.encodeFunctionData('deposit');
    await wallet.sendTransaction(WETH_ADDRESS, depositData, ethAmountWei);

    // 2. Approve Aave Pool to spend WETH
    console.log(`[Vouch] Approving Aave Pool for WETH`);
    const approveData = wethIface.encodeFunctionData('approve', [AAVE_POOL_ADDRESS, ethAmountWei]);
    await wallet.sendTransaction(WETH_ADDRESS, approveData, 0n);

    // 3. Supply WETH to Aave
    console.log(`[Vouch] Supplying WETH to Aave V3`);
    const poolIface = new ethers.Interface(POOL_ABI);
    const supplyData = poolIface.encodeFunctionData('supply', [WETH_ADDRESS, ethAmountWei, address, 0]);
    const txHash = await wallet.sendTransaction(AAVE_POOL_ADDRESS, supplyData, 0n);
    
    console.log(`[Vouch] Aave deposit confirmed: ${txHash}`);
    return txHash;
  } catch (err) {
    console.warn('[Vouch] Aave deposit failed (non-blocking):', (err as Error).message);
    return '';
  }
}

export async function withdrawForLoan(amount: number): Promise<string> {
  try {
    console.log(`[Vouch] Withdrawing ${amount} USDT equivalent from Aave V3`);

    const wallet = await getWallet();
    const address = await wallet.getAddress();
    const provider = getProvider();

    // Check aWETH balance
    const aWeth = new ethers.Contract(AWETH_ADDRESS, ERC20_ABI, provider);
    const aBalance: bigint = await aWeth.balanceOf(address);
    // Convert back to estimated USDT (assuming 1 ETH = $3000)
    const available = Number(ethers.formatEther(aBalance)) * 3000;

    if (available < amount) {
      console.warn(`[Vouch] Insufficient Aave balance: have $${available.toFixed(2)}, need $${amount}`);
      return '';
    }

    const ethAmount = amount / 3000;
    const ethAmountWei = ethers.parseEther(ethAmount.toString());

    // Withdraw WETH from Aave
    console.log(`[Vouch] Withdrawing WETH from Aave`);
    const poolIface = new ethers.Interface(POOL_ABI);
    const withdrawData = poolIface.encodeFunctionData('withdraw', [WETH_ADDRESS, ethAmountWei, address]);
    const txHash = await wallet.sendTransaction(AAVE_POOL_ADDRESS, withdrawData, 0n);

    // Note: To use as USDT, we'd swap WETH -> USDT, but for demo we just withdraw
    return txHash;
  } catch (err) {
    console.warn('[Vouch] Aave withdraw failed:', (err as Error).message);
    return '';
  }
}

export async function getAaveBalance(): Promise<number> {
  try {
    const wallet = await getWallet();
    const address = await wallet.getAddress();
    const provider = getProvider();

    const aWeth = new ethers.Contract(AWETH_ADDRESS, ERC20_ABI, provider);
    const balance: bigint = await aWeth.balanceOf(address);
    // Convert aWETH to approx USDT value for UI consistency
    return Number(ethers.formatEther(balance)) * 3000;
  } catch (err) {
    return 0;
  }
}
