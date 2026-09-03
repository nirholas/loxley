import { erc20Abi, getAddress, isAddress } from "viem";
import { PERMIT2_ADDRESS, assetForNetwork } from "@loxley/chain";
import type { Config } from "./config.js";
import type { FacilitatorDb } from "./db.js";
import type { NetworkSigner } from "./signer.js";

export type GasGrantResult =
  | { ok: true; txHash: `0x${string}`; amountWei: string; alreadyGranted: false }
  | { ok: true; txHash: string; amountWei: string; alreadyGranted: true }
  | { ok: false; reason: string; detail?: string };

/**
 * USDG on Robinhood Chain has no EIP-2612, so a fresh payer must send one on-chain approve(Permit2)
 * before any x402 payment can settle, and a wallet that only holds USDG cannot pay for that transaction.
 * A gas grant sends exactly enough ETH for the approve. It is bounded on every axis: once per address
 * per network, only to addresses that already hold USDG, only while they are still unapproved and
 * still below the grant amount, and only while the facilitator keeps its own reserve.
 */
export async function grantGas(
  cfg: Config,
  db: FacilitatorDb,
  signer: NetworkSigner,
  rawAddress: string,
): Promise<GasGrantResult> {
  if (!isAddress(rawAddress)) return { ok: false, reason: "invalid_address" };
  const address = getAddress(rawAddress);
  if (address.toLowerCase() === signer.address.toLowerCase()) return { ok: false, reason: "invalid_address" };

  const prior = db.getGasGrant(address, signer.network);
  if (prior) return { ok: true, txHash: prior.tx_hash, amountWei: prior.amount_wei, alreadyGranted: true };

  const usdg = assetForNetwork(signer.network).address;
  const [usdgBalance, allowance, ethBalance, ownBalance] = await Promise.all([
    signer.client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    signer.client.readContract({ address: usdg, abi: erc20Abi, functionName: "allowance", args: [address, PERMIT2_ADDRESS] }),
    signer.client.getBalance({ address }),
    signer.client.getBalance({ address: signer.address }),
  ]);

  if (usdgBalance < cfg.gasGrantMinUsdg) {
    return { ok: false, reason: "insufficient_usdg", detail: `hold at least ${cfg.gasGrantMinUsdg} atomic USDG to qualify` };
  }
  if (allowance > 0n) return { ok: false, reason: "already_approved", detail: "Permit2 allowance already set; no grant needed" };
  if (ethBalance >= cfg.gasGrantWei) return { ok: false, reason: "has_gas", detail: "address already holds enough ETH for approve()" };
  if (ownBalance - cfg.gasGrantWei < cfg.gasGrantReserveWei) {
    return { ok: false, reason: "facilitator_reserve", detail: "facilitator is below its gas reserve; try another facilitator" };
  }

  const txHash = await signer.client.sendTransaction({ to: address, value: cfg.gasGrantWei });
  db.recordGasGrant({ address, network: signer.network, tx_hash: txHash, amount_wei: cfg.gasGrantWei.toString() });
  return { ok: true, txHash, amountWei: cfg.gasGrantWei.toString(), alreadyGranted: false };
}
