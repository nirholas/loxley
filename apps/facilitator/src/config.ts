import { z } from "zod";
import { ROBINHOOD_CHAIN, ROBINHOOD_CHAIN_TESTNET, RPC_URLS, isRobinhoodNetwork, type RobinhoodNetwork } from "@loxley/chain";

const envSchema = z.object({
  FACILITATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "FACILITATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key"),
  FACILITATOR_NETWORKS: z.string().default(`${ROBINHOOD_CHAIN},${ROBINHOOD_CHAIN_TESTNET}`),
  FACILITATOR_PORT: z.coerce.number().int().positive().default(4663),
  FACILITATOR_DB: z.string().default("./data/facilitator.db"),
  RHC_MAINNET_RPC_URL: z.string().url().default(RPC_URLS[ROBINHOOD_CHAIN]),
  RHC_TESTNET_RPC_URL: z.string().url().default(RPC_URLS[ROBINHOOD_CHAIN_TESTNET]),
  /** ETH sent to a payer who holds USDG but cannot pay for their one-time Permit2 approve(). */
  GAS_GRANT_WEI: z.coerce.bigint().default(50_000_000_000_000n),
  /** A payer must hold at least this much USDG (atomic, 6 decimals) to receive a gas grant. */
  GAS_GRANT_MIN_USDG: z.coerce.bigint().default(1_000_000n),
  /** Stop granting when the facilitator's own balance falls below this (wei). */
  GAS_GRANT_RESERVE_WEI: z.coerce.bigint().default(2_000_000_000_000_000n),
  PUBLIC_URL: z.string().url().optional(),
  /** Trusted ERC-6492 smart-wallet factories, comma-separated. Empty disables counterfactual deploys. */
  EIP6492_FACTORIES: z.string().default(""),
});

export type Config = {
  privateKey: `0x${string}`;
  networks: RobinhoodNetwork[];
  port: number;
  dbPath: string;
  rpcUrls: Record<RobinhoodNetwork, string>;
  gasGrantWei: bigint;
  gasGrantMinUsdg: bigint;
  gasGrantReserveWei: bigint;
  publicUrl?: string;
  eip6492Factories: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const networks = parsed.FACILITATOR_NETWORKS.split(",").map((n) => n.trim()).filter(Boolean);
  for (const n of networks) {
    if (!isRobinhoodNetwork(n)) throw new Error(`FACILITATOR_NETWORKS: unsupported network ${n}`);
  }
  if (networks.length === 0) throw new Error("FACILITATOR_NETWORKS is empty");
  return {
    privateKey: parsed.FACILITATOR_PRIVATE_KEY as `0x${string}`,
    networks: networks as RobinhoodNetwork[],
    port: parsed.FACILITATOR_PORT,
    dbPath: parsed.FACILITATOR_DB,
    rpcUrls: {
      [ROBINHOOD_CHAIN]: parsed.RHC_MAINNET_RPC_URL,
      [ROBINHOOD_CHAIN_TESTNET]: parsed.RHC_TESTNET_RPC_URL,
    },
    gasGrantWei: parsed.GAS_GRANT_WEI,
    gasGrantMinUsdg: parsed.GAS_GRANT_MIN_USDG,
    gasGrantReserveWei: parsed.GAS_GRANT_RESERVE_WEI,
    publicUrl: parsed.PUBLIC_URL,
    eip6492Factories: parsed.EIP6492_FACTORIES.split(",").map((s) => s.trim()).filter(Boolean),
  };
}
