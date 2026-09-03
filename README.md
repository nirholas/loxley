# Loxley

**The x402 rail for Robinhood Chain.** An open facilitator, a facilitator router with failover, a settlement explorer, a per-request escrow with attested refunds, and ERC-8004 agent identity, all for USDG payments on Robinhood Chain (`eip155:4663`) and its testnet (`eip155:46630`).

Everything runs on the canonical contracts the reference x402 SDKs already use (Uniswap Permit2 and the audited `x402ExactPermit2Proxy` / `x402UptoPermit2Proxy`, both live on 4663 and 46630) and on the reference `@x402/*` packages. Apache-2.0.

## Why this exists

Robinhood Chain's stablecoin, USDG, implements neither EIP-3009 nor EIP-2612. That has three consequences the rest of the x402 ecosystem never had to deal with:

1. Every payment is a Permit2 witness transfer, so a payer needs one on-chain `approve(Permit2)` before their first payment, and a wallet that only holds USDG cannot pay for that transaction.
2. USDG is not a registered default asset in the published SDKs, so a stock reference client refuses to pay a 4663 quote at all (`spendControls` rejects non-default assets).
3. Every seller on the chain pointed at a single hosted facilitator, with no failover and no way to see what was settling.

Loxley fixes all three: an upstream registry PR plus a runtime shim for (2), approval gas grants and an approval helper for (1), and a router, an explorer and a self-hostable facilitator for (3). Then it adds the two contracts the chain was missing: an escrow so a bad response is a refund instead of a loss, and the ERC-8004 registries so agents have an identity here.

## What is in the box

| Package | What it is |
|---|---|
| [`packages/chain`](packages/chain) (`@loxley/chain`) | Chain 4663/46630 as data: viem chain definitions, USDG, Permit2, proxy and CREATE2 addresses, a strict dollar-to-atomic parser, and `registerRobinhoodMoneyParser()` so `"$0.01"` works on any `x402ResourceServer` today. |
| [`packages/sdk`](packages/sdk) (`@loxley/sdk`) | `FacilitatorRouter` (health-scored, benching, settle-safe failover, drop-in `FacilitatorClient`), `createRobinhoodPayer()` (a fetch that pays 402s in USDG), `ensurePermit2Approval()`, `getApprovalState()`, `requestGasGrant()`. |
| [`apps/facilitator`](apps/facilitator) | The Loxley facilitator: exact + upto schemes on both networks, ERC-20 approval gas sponsoring, idempotent settles keyed on a canonical payload hash, a persisted Bazaar discovery catalog, `/gas-grant`, `/health`, `/stats`, `/metrics`. SQLite journal. Fork-based end-to-end test. |
| [`apps/scan`](apps/scan) | Loxley Scan: indexes every `settle()` / `settleWithPermit()` on the canonical proxies, decodes payer, payee, facilitator and amount, and serves JSON plus a server-rendered UI with leaderboards, a daily chart, per-address and per-tx pages. |
| [`contracts`](contracts) | `LoxleyEscrow` (Permit2-funded, attestor-released, refund on rejection, reclaim on silence, no admin, no upgrade), `MockUSDG` (testnet USDG with a faucet), deterministic deploy scripts for both plus the ERC-8004 reference registries. |
| [`apps/web`](apps/web) | The landing page. Static HTML. |
| [`docs`](docs) | Operator, integrator and contract documentation. Start at [docs/README.md](docs/README.md). |

## Quickstart

```bash
git clone https://github.com/nirholas/loxley && cd loxley
pnpm install
pnpm -r build
pnpm test                       # vitest across packages and apps
pnpm contracts:test             # forge: 13 unit tests against real Permit2 bytecode
RHC_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com pnpm --filter @loxley/facilitator e2e   # anvil fork of mainnet
```

### Pay a 402 in USDG

```ts
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain, createRobinhoodPayer, ensurePermit2Approval } from "@loxley/sdk";

const wallet = createWalletClient({ account: privateKeyToAccount(KEY), chain: robinhoodChain, transport: http() }).extend(publicActions);
await ensurePermit2Approval(wallet, "eip155:4663");      // one-time on-chain approve(Permit2); returns null if already done
const pay = createRobinhoodPayer(wallet);                 // fetch that answers 402s, spend controls opened for USDG
const res = await pay("https://quotes.example/aapl");
```

### Charge for an endpoint with facilitator failover

```ts
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { FacilitatorRouter, KNOWN_FACILITATORS, registerRobinhoodMoneyParser } from "@loxley/sdk";

const router = new FacilitatorRouter(KNOWN_FACILITATORS, { requireNetwork: "eip155:4663" });
const server = new x402ResourceServer(router);
server.register("eip155:*", new ExactEvmScheme());
registerRobinhoodMoneyParser(server);                     // "$0.01" -> 10000 atomic USDG with the permit2 hint
```

### Run a facilitator

```bash
cp .env.example .env            # set FACILITATOR_PRIVATE_KEY (needs a little ETH on 4663 / 46630)
pnpm facilitator                # http://localhost:4663
curl -s localhost:4663/supported
```

### Run the explorer

```bash
pnpm --filter @loxley/scan index   # one catch-up pass, then exit
pnpm scan                          # index continuously and serve http://localhost:4664
```

## Contracts

| Contract | Address (4663 and 46630, deterministic) | Status |
|---|---|---|
| `LoxleyEscrow` | `0xbE7523F2dd81cF23256342423A3CD898AA4E21E7` | computed; deploy with `script/DeployEscrow.s.sol` |
| ERC-8004 `IdentityRegistry` | `0x9Cdee67C9A8B7A50503d4487676830bbC2a15E77` | computed; deploy with `script/DeployAgentRegistries.s.sol` |
| ERC-8004 `ReputationRegistry` | `0x76dbE5d83496beBBad3567Df16dA9CC0AD7CEd4e` | computed |
| ERC-8004 `ValidationRegistry` | `0x2d712371187Ac16C27B685d730bF6295D0ca9e68` | computed |
| `MockUSDG` (testnet only) | printed by `script/DeployMockUSDG.s.sol`; refuses chain 4663 | |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | live on both |
| `x402ExactPermit2Proxy` | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` | live on both |
| `x402UptoPermit2Proxy` | `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002` | live on both |
| USDG (mainnet) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | live, 6 decimals, no EIP-3009, no EIP-2612 |

The "computed" rows are the CREATE2 addresses the deploy scripts will produce; they hold on any chain with the Arachnid deployer and do not depend on the deploying key. Each script skips anything already deployed, so re-running is safe.

## Upstream

`upstream/x402-robinhood-chain.patch` registers USDG as the default asset for `eip155:4663` in the TypeScript, Go and Python x402 SDKs and the network support docs, following the project's `DEFAULT_ASSETS.md`. Until that merges, `registerRobinhoodMoneyParser()` and `createRobinhoodPayer()` cover the gap at runtime.

## Layout

```
packages/chain        registry + viem chains + money parser
packages/sdk          router + payer helpers
apps/facilitator      the facilitator service (+ scripts/e2e.ts)
apps/scan             the explorer (indexer + API + UI)
apps/web              landing page
contracts             Foundry: src, test, script, lib (forge-std, OpenZeppelin v5, Permit2, ERC-8004 RI)
docs                  documentation
upstream              the x402 registry patch
```

## License

Apache-2.0. Not affiliated with Robinhood Markets or Paxos.
