import { erc20Abi, maxUint256, type Account, type Chain, type PublicClient, type Transport, type WalletClient } from "viem";
import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { PERMIT2_ADDRESS, RPC_URLS, assetForNetwork, isRobinhoodNetwork, type RobinhoodNetwork } from "@loxley/chain";

export type PayerOptions = {
  /** Which Robinhood Chain networks this payer will pay on. Default: both. */
  networks?: RobinhoodNetwork[];
  /**
   * Per-payment cap in atomic USDG (6 decimals). Default "1000000" ($1), matching the reference client's
   * default for registered assets. Pass false to remove the cap.
   */
  maxAmountPerPayment?: string | false;
  /** RPC override per network (public RPCs are rate limited). */
  rpcUrls?: Partial<Record<RobinhoodNetwork, string>>;
  /** Refuse any single payment above this USD amount, e.g. "$1". Default: uncapped. */
  maxAmountPerPayment?: string;
  fetch?: typeof globalThis.fetch;
};

type ViemWallet = WalletClient<Transport, Chain, Account> & Pick<PublicClient, "readContract" | "getTransactionCount" | "estimateFeesPerGas">;

/**
 * A fetch that pays x402 402s on Robinhood Chain in USDG. Wraps @x402/fetch with the exact EVM scheme
 * registered for 4663 and 46630, and pins the RPC used for Permit2 nonce and allowance reads.
 *
 *   const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http() }).extend(publicActions);
 *   const pay = createRobinhoodPayer(wallet);
 *   const res = await pay("https://api.example/quote?symbol=AAPL");
 */
export function createRobinhoodPayer(wallet: ViemWallet, options: PayerOptions = {}) {
  const networks = options.networks ?? (["eip155:4663", "eip155:46630"] as RobinhoodNetwork[]);
  const signer = toClientEvmSigner(
    {
      address: wallet.account.address,
      signTypedData: (message) => wallet.signTypedData({ account: wallet.account, ...(message as Record<string, unknown>) } as never),
    },
    wallet,
  );
  const client = new x402Client();
  // USDG is not yet a default asset in the reference SDKs, and 2.24+ spend controls reject
  // non-default assets by default. Allow USDG on the configured networks explicitly.
  client.setSpendControls({
    allowedAssets: networks.map((n) => ({ network: n, asset: assetForNetwork(n).address })),
    maxAmountPerPayment: options.maxAmountPerPayment ?? false,
  });
  registerExactEvmScheme(client, {
    signer,
    networks,
    schemeOptions: Object.fromEntries(
      networks.map((n) => [Number(n.split(":")[1]), { rpcUrl: options.rpcUrls?.[n] ?? RPC_URLS[n] }]),
    ),
  });
  return wrapFetchWithPayment(options.fetch ?? globalThis.fetch, client);
}

export type ApprovalState = { approved: boolean; allowance: bigint; usdgBalance: bigint; ethBalance: bigint };

/** Read whether a payer can already sign Permit2 payments for USDG on a network. */
export async function getApprovalState(
  client: Pick<PublicClient, "readContract" | "getBalance">,
  owner: `0x${string}`,
  network: string,
): Promise<ApprovalState> {
  if (!isRobinhoodNetwork(network)) throw new Error(`not a Robinhood Chain network: ${network}`);
  const usdg = assetForNetwork(network).address;
  const [allowance, usdgBalance, ethBalance] = await Promise.all([
    client.readContract({ address: usdg, abi: erc20Abi, functionName: "allowance", args: [owner, PERMIT2_ADDRESS] }),
    client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.getBalance({ address: owner }),
  ]);
  return { approved: allowance > 0n, allowance, usdgBalance, ethBalance };
}

/**
 * USDG has no EIP-2612, so the one-time Permit2 approval is an on-chain transaction from the payer.
 * Sends it if missing and waits for the receipt. Returns the tx hash, or null when already approved.
 */
export async function ensurePermit2Approval(wallet: ViemWallet & Pick<PublicClient, "getBalance" | "waitForTransactionReceipt">, network: string): Promise<`0x${string}` | null> {
  const state = await getApprovalState(wallet, wallet.account.address, network);
  if (state.approved) return null;
  const usdg = assetForNetwork(network).address;
  const hash = await wallet.writeContract({
    address: usdg,
    abi: erc20Abi,
    functionName: "approve",
    args: [PERMIT2_ADDRESS, maxUint256],
    account: wallet.account,
    chain: wallet.chain,
  });
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Permit2 approval failed: ${hash}`);
  return hash;
}

/**
 * Ask a Loxley facilitator to fund the payer's approval gas. The facilitator only pays for addresses
 * that hold USDG, have no Permit2 allowance yet, and cannot cover the approve() themselves.
 */
export async function requestGasGrant(
  facilitatorUrl: string,
  address: `0x${string}`,
  network: string = "eip155:4663",
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ ok: true; txHash: string; amountWei: string; alreadyGranted: boolean } | { ok: false; reason: string; detail?: string }> {
  const res = await fetchImpl(`${facilitatorUrl.replace(/\/+$/, "")}/gas-grant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, network }),
  });
  return (await res.json()) as never;
}
