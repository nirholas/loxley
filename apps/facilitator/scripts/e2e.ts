/**
 * End-to-end: a real payer pays a real seller through the Loxley facilitator on a fork of Robinhood Chain.
 *
 * Starts anvil forked from RHC_MAINNET_RPC_URL, funds a payer with USDG (storage write) and ETH,
 * boots the facilitator against the fork, builds a Permit2 payment with the reference x402 client,
 * verifies + settles through HTTP, and asserts USDG moved payer -> payee on the fork.
 *
 *   pnpm --filter @loxley/facilitator e2e
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWalletClient, http, publicActions, erc20Abi, keccak256, encodeAbiParameters, toHex, pad, maxUint256, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { PERMIT2_ADDRESS, ROBINHOOD_CHAIN, USDG_ADDRESS, robinhoodChain } from "@loxley/chain";
import { FacilitatorDb } from "../src/db.js";
import { buildFacilitator } from "../src/facilitator.js";
import { createServer } from "../src/server.js";
import { buildSigner, type NetworkSigner } from "../src/signer.js";
import type { Config } from "../src/config.js";
import { serve } from "@hono/node-server";

const UPSTREAM = process.env.RHC_MAINNET_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const ANVIL_PORT = 8545 + Math.floor(Math.random() * 500);
const ANVIL = `http://127.0.0.1:${ANVIL_PORT}`;
const FACILITATOR_PORT = 9400 + Math.floor(Math.random() * 500);

const FACILITATOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // anvil #1
const PAYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const; // anvil #2
const PAYEE = "0x000000000000000000000000000000000000dEaD" as const;
const USDG_BALANCES_SLOT = 1n;

let anvil: ChildProcess | undefined;
const kill = () => anvil?.kill("SIGKILL");
process.on("exit", kill);

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function waitForAnvil(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await rpc("eth_chainId", []);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("anvil did not start");
}

function step(msg: string) {
  console.log(`\n▸ ${msg}`);
}

async function main() {
  step(`forking ${UPSTREAM} with anvil on :${ANVIL_PORT}`);
  anvil = spawn("anvil", ["--fork-url", UPSTREAM, "--port", String(ANVIL_PORT), "--silent", "--chain-id", "4663"], { stdio: "ignore" });
  await waitForAnvil();

  const payer = privateKeyToAccount(PAYER_KEY);
  const facilitatorAccount = privateKeyToAccount(FACILITATOR_KEY);
  step(`funding payer ${payer.address} with 100 USDG (storage) and 1 ETH; facilitator ${facilitatorAccount.address} with 1 ETH`);
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [payer.address, USDG_BALANCES_SLOT]));
  await rpc("anvil_setStorageAt", [USDG_ADDRESS, slot, pad(toHex(100_000_000n))]);
  await rpc("anvil_setBalance", [payer.address, toHex(parseEther("1"))]);
  await rpc("anvil_setBalance", [facilitatorAccount.address, toHex(parseEther("1"))]);

  const payerClient = createWalletClient({ account: payer, chain: { ...robinhoodChain, rpcUrls: { default: { http: [ANVIL] } } }, transport: http(ANVIL) }).extend(publicActions);
  const usdgBefore = await payerClient.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [payer.address] });
  if (usdgBefore !== 100_000_000n) throw new Error(`storage funding failed, balance ${usdgBefore}`);

  step("payer approves Permit2 once (USDG has no EIP-2612, so this is an on-chain approve)");
  const approveHash = await payerClient.writeContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, maxUint256] });
  await payerClient.waitForTransactionReceipt({ hash: approveHash });

  step(`booting Loxley facilitator on :${FACILITATOR_PORT} against the fork`);
  const cfg: Config = {
    privateKey: FACILITATOR_KEY,
    networks: [ROBINHOOD_CHAIN],
    port: FACILITATOR_PORT,
    dbPath: ":memory:",
    rpcUrls: { "eip155:4663": ANVIL, "eip155:46630": ANVIL },
    gasGrantWei: 50_000_000_000_000n,
    gasGrantMinUsdg: 1_000_000n,
    gasGrantReserveWei: 0n,
    eip6492Factories: [],
  };
  const db = new FacilitatorDb(":memory:");
  const signers = new Map<string, NetworkSigner>([[ROBINHOOD_CHAIN, buildSigner(FACILITATOR_KEY, ROBINHOOD_CHAIN, ANVIL)]]);
  const facilitator = buildFacilitator(cfg, db, signers);
  const app = createServer({ cfg, db, facilitator, signers });
  const server = serve({ fetch: app.fetch, port: FACILITATOR_PORT });
  const F = `http://127.0.0.1:${FACILITATOR_PORT}`;

  const supported = (await (await fetch(`${F}/supported`)).json()) as { kinds: Array<{ scheme: string; network: string }> };
  console.log("  /supported kinds:", supported.kinds.map((k) => `${k.scheme}@${k.network}`).join(", "));

  step("seller publishes a 402 for $0.01 USDG; payer signs a Permit2 payment with the reference x402 client");
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: ROBINHOOD_CHAIN,
    amount: "10000",
    asset: USDG_ADDRESS,
    payTo: PAYEE,
    maxTimeoutSeconds: 120,
    extra: { assetTransferMethod: "permit2" },
  };
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    accepts: [requirements],
    resource: { url: "https://quotes.example/aapl", description: "Stock token reference quote", mimeType: "application/json" },
  };
  const client = new x402Client();
  client.setSpendControls({ allowedAssets: [{ network: ROBINHOOD_CHAIN, asset: USDG_ADDRESS }] });
  registerExactEvmScheme(client, {
    signer: toClientEvmSigner({ address: payer.address, signTypedData: (m) => payerClient.signTypedData(m as never) }, payerClient),
    networks: [ROBINHOOD_CHAIN],
    schemeOptions: { 4663: { rpcUrl: ANVIL } },
  });
  const paymentPayload = await client.createPaymentPayload(paymentRequired);

  step("POST /verify");
  const verify = (await (await fetch(`${F}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }) })).json()) as { isValid: boolean; invalidReason?: string; invalidMessage?: string };
  console.log("  ", verify);
  if (!verify.isValid) throw new Error(`verify failed: ${verify.invalidReason} ${verify.invalidMessage ?? ""}`);

  step("POST /settle");
  const settle = (await (await fetch(`${F}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }) })).json()) as { success: boolean; transaction?: string; errorReason?: string };
  console.log("  ", settle);
  if (!settle.success) throw new Error(`settle failed: ${settle.errorReason}`);

  const payeeBalance = await payerClient.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [PAYEE] });
  const payerAfter = await payerClient.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [payer.address] });
  console.log(`  payer ${usdgBefore} -> ${payerAfter} USDG atomic; payee received ${payeeBalance}`);
  if (usdgBefore - payerAfter !== 10_000n) throw new Error("payer was not debited exactly 0.01 USDG");

  step("POST /settle again with the same payload (idempotency)");
  const replayRes = await fetch(`${F}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }) });
  const replay = (await replayRes.json()) as { success: boolean; transaction?: string };
  console.log("  ", replay, "replay header:", replayRes.headers.get("x-loxley-idempotent-replay"));
  if (!replay.success || replay.transaction !== settle.transaction) throw new Error("idempotent replay did not return the original receipt");
  const payerAfterReplay = await payerClient.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [payer.address] });
  if (payerAfterReplay !== payerAfter) throw new Error("replay charged the payer twice");

  step("GET /stats and /metrics");
  console.log("  ", await (await fetch(`${F}/stats`)).json());
  console.log((await (await fetch(`${F}/metrics`)).text()).split("\n").filter((l) => l.startsWith("loxley_settle")).join("\n"));

  step("POST /gas-grant for a fresh USDG holder with no ETH");
  const fresh = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
  const freshSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [fresh.address, USDG_BALANCES_SLOT]));
  await rpc("anvil_setStorageAt", [USDG_ADDRESS, freshSlot, pad(toHex(5_000_000n))]);
  const grant = (await (await fetch(`${F}/gas-grant`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: fresh.address, network: ROBINHOOD_CHAIN }) })).json()) as { ok: boolean; txHash?: string; reason?: string };
  console.log("  ", grant);
  if (!grant.ok) throw new Error(`gas grant refused: ${grant.reason}`);
  const freshEth = await payerClient.getBalance({ address: fresh.address });
  if (freshEth !== cfg.gasGrantWei) throw new Error(`grant not delivered: ${freshEth}`);
  const again = (await (await fetch(`${F}/gas-grant`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: fresh.address, network: ROBINHOOD_CHAIN }) })).json()) as { alreadyGranted?: boolean };
  if (!again.alreadyGranted) throw new Error("second grant was not deduplicated");

  console.log("\n✔ e2e passed: verify, settle, idempotent replay, stats, gas grant");
  server.close();
  db.close();
  kill();
  process.exit(0);
}

main().catch((error) => {
  console.error("\n✖ e2e failed:", error);
  kill();
  process.exit(1);
});
