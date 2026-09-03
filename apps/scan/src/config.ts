import { z } from "zod";
import { ROBINHOOD_CHAIN, ROBINHOOD_CHAIN_TESTNET, RPC_URLS, isRobinhoodNetwork, type RobinhoodNetwork } from "@loxley/chain";

const schema = z.object({
  SCAN_NETWORK: z.string().default(ROBINHOOD_CHAIN),
  SCAN_DB: z.string().default("./data/scan.db"),
  SCAN_PORT: z.coerce.number().int().positive().default(4664),
  RHC_MAINNET_RPC_URL: z.string().url().default(RPC_URLS[ROBINHOOD_CHAIN]),
  RHC_TESTNET_RPC_URL: z.string().url().default(RPC_URLS[ROBINHOOD_CHAIN_TESTNET]),
  /** First block to index. Default: a block shortly before the first proxy settlement on mainnet. */
  SCAN_START_BLOCK: z.coerce.number().int().nonnegative().optional(),
  /** eth_getLogs window. The public RPC handles 50k; Alchemy handles far more. */
  SCAN_WINDOW: z.coerce.number().int().positive().default(20_000),
  /** Poll interval for the head once caught up (ms). */
  SCAN_POLL_MS: z.coerce.number().int().positive().default(4_000),
  /** Blocks behind head to treat as final for the indexer cursor. */
  SCAN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(20),
  PUBLIC_URL: z.string().url().optional(),
});

export type ScanConfig = {
  network: RobinhoodNetwork;
  dbPath: string;
  port: number;
  rpcUrl: string;
  startBlock: number;
  window: number;
  pollMs: number;
  confirmations: number;
  publicUrl?: string;
};

/** Block 50,000,000 predates the first proxy settlement on 4663 (mainnet opened 2026-07-01 near block 3.3e7... the proxies saw their first settle later). */
const DEFAULT_START: Record<RobinhoodNetwork, number> = {
  [ROBINHOOD_CHAIN]: 48_000_000,
  [ROBINHOOD_CHAIN_TESTNET]: 100_000_000,
};

export function loadScanConfig(env: NodeJS.ProcessEnv = process.env): ScanConfig {
  const p = schema.parse(env);
  if (!isRobinhoodNetwork(p.SCAN_NETWORK)) throw new Error(`SCAN_NETWORK: unsupported network ${p.SCAN_NETWORK}`);
  const network = p.SCAN_NETWORK;
  return {
    network,
    dbPath: p.SCAN_DB,
    port: p.SCAN_PORT,
    rpcUrl: network === ROBINHOOD_CHAIN ? p.RHC_MAINNET_RPC_URL : p.RHC_TESTNET_RPC_URL,
    startBlock: p.SCAN_START_BLOCK ?? DEFAULT_START[network],
    window: p.SCAN_WINDOW,
    pollMs: p.SCAN_POLL_MS,
    confirmations: p.SCAN_CONFIRMATIONS,
    publicUrl: p.PUBLIC_URL,
  };
}
