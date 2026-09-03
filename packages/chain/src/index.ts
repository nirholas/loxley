import { defineChain, type Chain } from "viem";

/** CAIP-2 identifiers. */
export const ROBINHOOD_CHAIN = "eip155:4663" as const;
export const ROBINHOOD_CHAIN_TESTNET = "eip155:46630" as const;
export type RobinhoodNetwork = typeof ROBINHOOD_CHAIN | typeof ROBINHOOD_CHAIN_TESTNET;

/** Canonical contracts shared by both networks (deterministic CREATE2 deployments). */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const X402_EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as const;
export const X402_UPTO_PERMIT2_PROXY = "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" as const;
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;

/**
 * USDG (Global Dollar, Paxos) on Robinhood Chain mainnet. 6 decimals, EIP-1967 proxy.
 * The token implements neither EIP-3009 nor EIP-2612, so x402 payments use Permit2 and
 * the one-time Permit2 approval must be an on-chain approve() (or a sponsored one).
 */
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const USDG_DECIMALS = 6;

/** Testnet USDG is a Loxley-deployed faucet token (see contracts/src/MockUSDG.sol). Filled by the deploy script. */
export const TESTNET_USDG_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export type AssetInfo = {
  address: `0x${string}`;
  /** EIP-712 name. Only meaningful for EIP-3009/EIP-2612 tokens; USDG signs through Permit2. */
  name: string;
  version: string;
  decimals: number;
  assetTransferMethod: "permit2";
  supportsEip2612: false;
};

export const ASSETS: Record<RobinhoodNetwork, AssetInfo> = {
  [ROBINHOOD_CHAIN]: {
    address: USDG_ADDRESS,
    name: "Global Dollar",
    version: "1",
    decimals: USDG_DECIMALS,
    assetTransferMethod: "permit2",
    supportsEip2612: false,
  },
  [ROBINHOOD_CHAIN_TESTNET]: {
    address: TESTNET_USDG_ADDRESS,
    name: "Global Dollar",
    version: "1",
    decimals: USDG_DECIMALS,
    assetTransferMethod: "permit2",
    supportsEip2612: false,
  },
};

export const RPC_URLS: Record<RobinhoodNetwork, string> = {
  [ROBINHOOD_CHAIN]: "https://rpc.mainnet.chain.robinhood.com",
  [ROBINHOOD_CHAIN_TESTNET]: "https://rpc.testnet.chain.robinhood.com",
};

export const EXPLORER_URLS: Record<RobinhoodNetwork, string> = {
  [ROBINHOOD_CHAIN]: "https://robinhoodchain.blockscout.com",
  [ROBINHOOD_CHAIN_TESTNET]: "https://robinhoodchain-testnet.blockscout.com",
};

export const robinhoodChain: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URLS[ROBINHOOD_CHAIN]] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URLS[ROBINHOOD_CHAIN] } },
  contracts: { multicall3: { address: MULTICALL3_ADDRESS } },
});

export const robinhoodChainTestnet: Chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URLS[ROBINHOOD_CHAIN_TESTNET]] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URLS[ROBINHOOD_CHAIN_TESTNET] } },
  contracts: { multicall3: { address: MULTICALL3_ADDRESS } },
  testnet: true,
});

export const CHAINS: Record<RobinhoodNetwork, Chain> = {
  [ROBINHOOD_CHAIN]: robinhoodChain,
  [ROBINHOOD_CHAIN_TESTNET]: robinhoodChainTestnet,
};

export function isRobinhoodNetwork(network: string): network is RobinhoodNetwork {
  return network === ROBINHOOD_CHAIN || network === ROBINHOOD_CHAIN_TESTNET;
}

export function chainForNetwork(network: string): Chain {
  if (!isRobinhoodNetwork(network)) throw new Error(`not a Robinhood Chain network: ${network}`);
  return CHAINS[network];
}

export function assetForNetwork(network: string): AssetInfo {
  if (!isRobinhoodNetwork(network)) throw new Error(`not a Robinhood Chain network: ${network}`);
  return ASSETS[network];
}

/**
 * Parse a dollar string ("$0.01", "0.25", "$1") into USDG atomic units (6 decimals).
 * Rejects more than 6 fractional digits instead of silently rounding.
 */
export function parseUsdg(price: string | number): bigint {
  const text = String(price).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`invalid USD price: ${price}`);
  const [whole, frac = ""] = text.split(".");
  if (frac.length > USDG_DECIMALS) throw new Error(`price ${price} has more than ${USDG_DECIMALS} decimals`);
  return BigInt(whole) * 10n ** BigInt(USDG_DECIMALS) + BigInt(frac.padEnd(USDG_DECIMALS, "0"));
}

/** Format USDG atomic units for display: 10000n -> "0.01". */
export function formatUsdg(atomic: bigint | string | number): string {
  const n = BigInt(atomic);
  const whole = n / 10n ** BigInt(USDG_DECIMALS);
  const frac = (n % 10n ** BigInt(USDG_DECIMALS)).toString().padStart(USDG_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * The `extra` an x402 resource server must advertise for a Permit2 asset without EIP-2612.
 * Matches what @x402/evm's ExactEvmScheme server emits for registered Permit2 defaults.
 */
export function usdgRequirementsExtra(): { assetTransferMethod: "permit2" } {
  return { assetTransferMethod: "permit2" };
}

type MoneyParser = (amount: number, network: string) => Promise<
  { amount: string; asset: string; extra?: Record<string, unknown> } | undefined
>;

/**
 * Teach an @x402/core resource server what "$0.01" means on Robinhood Chain.
 * Works with today's published SDKs; becomes redundant once the upstream default-asset PR lands.
 *
 *   import { x402ResourceServer } from "@x402/core/server";
 *   registerRobinhoodMoneyParser(server);
 */
export function registerRobinhoodMoneyParser(server: { registerMoneyParser: (p: MoneyParser) => unknown }): void {
  server.registerMoneyParser(async (amount, network) => {
    if (!isRobinhoodNetwork(network)) return undefined;
    const asset = ASSETS[network];
    return {
      amount: parseUsdg(amount.toFixed(USDG_DECIMALS)).toString(),
      asset: asset.address,
      extra: usdgRequirementsExtra(),
    };
  });
}
