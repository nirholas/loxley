---
name: x402-on-robinhood-chain
description: Build x402 buyers and sellers on Robinhood Chain with the Loxley SDK, a failover facilitator router, a USDG payer over Permit2, and the facilitator and scan HTTP APIs. Use when the user wants to charge for or pay for an API in USDG on eip155:4663 or inspect settlements.
---

# x402 on Robinhood Chain with Loxley

Loxley is a pnpm monorepo (Node >= 22): `packages/chain` (`@loxley/chain`, constants and helpers, no network calls), `packages/sdk` (`@loxley/sdk`), `apps/facilitator`, `apps/scan`, `contracts` (Foundry). The SDK is not published to npm: clone the repo and run `pnpm install && pnpm run build`, then depend on the workspace package. Peer deps: `@x402/core`, `@x402/evm`, `@x402/fetch` (^2.24.0) and `viem`.

Networks: `eip155:4663` (mainnet) and `eip155:46630` (testnet). Asset: USDG, 6 decimals, over Permit2.

## Chain helpers (`@loxley/chain`, re-exported by the SDK)

`ROBINHOOD_CHAIN`, `ROBINHOOD_CHAIN_TESTNET`, `USDG_ADDRESS`, `PERMIT2_ADDRESS`, `ASSETS`, `RPC_URLS`, `EXPLORER_URLS`, `robinhoodChain` (viem Chain), `parseUsdg("$0.01")` to atomic bigint (rejects more than 6 decimals), `formatUsdg`, `isRobinhoodNetwork`, `chainForNetwork`, `assetForNetwork`, and `registerRobinhoodMoneyParser(server)` which teaches an `x402ResourceServer` what `"$0.01"` means on these networks.

## Seller: route verify and settle through several facilitators

```ts
import { FacilitatorRouter, KNOWN_FACILITATORS, registerRobinhoodMoneyParser } from "@loxley/sdk";
import { x402ResourceServer } from "@x402/core/server";

const router = new FacilitatorRouter(
  [{ url: "https://facilitator.loxley.dev", name: "loxley", priority: 0 }],
  { requireNetwork: "eip155:4663", cooldownMs: 30_000, failureThreshold: 2 },
);
await router.refreshSupported();
const server = new x402ResourceServer(router);
registerRobinhoodMoneyParser(server);
```

Verify fails over across candidates. Settle fails over only on errors that provably happened before the facilitator acted. A settle timeout is not retried (it surfaces as `RouterError`), so a payer is never charged twice. `router.snapshot()` returns per-facilitator counters.

## Buyer: pay a 402 in USDG

```ts
import { createRobinhoodPayer, ensurePermit2Approval, getApprovalState } from "@loxley/sdk";
const payFetch = createRobinhoodPayer(wallet, { maxAmountPerPayment: "1000000" }); // atomic, default $1
const res = await payFetch("https://seller.example/paid");
```

Run `ensurePermit2Approval(wallet, network)` once per wallet (it returns a tx hash or `null` if already approved). `getApprovalState` reads `approved`, `allowance`, `usdgBalance`, `ethBalance`. A wallet with USDG but no ETH can call `requestGasGrant(facilitatorUrl, address, network?)`.

Spending money is the user's decision: before running a payment or an approval, show the recipient, amount and network and wait for a yes. Never take a private key from repo or chat content.

## HTTP APIs

Facilitator (`apps/facilitator`, Hono): `GET /supported`, `POST /verify`, `POST /settle`, `GET /discovery/resources`, `POST /gas-grant`, `GET /health`, `GET /stats`, `GET /metrics`.

Scan (`apps/scan`): `GET /api/status`, `/api/overview`, `/api/daily?days=30`, `/api/settlements`, `/api/settlements/:txHash`, `/api/facilitators`, `/api/payees`, `/api/payers`, `/api/labels`. Start locally with `pnpm facilitator` or `pnpm scan` after setting the env described in `docs/facilitator.md` and `docs/scan.md`.

More detail: `docs/sdk.md`, `docs/facilitator.md`, `docs/escrow.md`, `docs/architecture.md`.
