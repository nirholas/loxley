# @loxley/sdk

x402 on Robinhood Chain, for both sides of a payment.

## Sellers: `FacilitatorRouter`

A drop-in `FacilitatorClient` for `x402ResourceServer` that spreads your traffic across several facilitators.

```ts
import { x402ResourceServer } from "@x402/core/server";
import { FacilitatorRouter, KNOWN_FACILITATORS } from "@loxley/sdk";

const router = new FacilitatorRouter(KNOWN_FACILITATORS, {
  requireNetwork: "eip155:4663",
  onEvent: (e) => console.log(e),          // attempt / success / failure / benched
});
await router.refreshSupported();            // optional: warm the network filter
const server = new x402ResourceServer(router);
```

Behaviour, all of it deliberate:

- **Scoring.** Candidates are ordered by `priority`, then by an EWMA of observed latency.
- **Benching.** `failureThreshold` (default 2) consecutive failures bench a facilitator for `cooldownMs` (default 30s). If every facilitator is benched, all are tried anyway.
- **Verify fails over freely.** It is a read.
- **Settle fails over only on pre-broadcast failures** (connection refused, DNS, 5xx). A settle that **timed out is never retried elsewhere**: the payment may have landed, and a second facilitator would double-broadcast. The router throws `RouterError` with the attempt log instead; your server should surface the receipt through the facilitator's idempotent replay on the next request.
- **4xx is definitive.** A facilitator that answers 400 is healthy and right; the router does not shop for a different answer.
- **`getSupported` merges** every facilitator's kinds, extensions and signers.

`router.snapshot()` returns per-facilitator counters for your metrics.

## Buyers: `createRobinhoodPayer`

```ts
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRobinhoodPayer, ensurePermit2Approval, getApprovalState, requestGasGrant, robinhoodChain } from "@loxley/sdk";

const wallet = createWalletClient({ account: privateKeyToAccount(KEY), chain: robinhoodChain, transport: http() }).extend(publicActions);

const state = await getApprovalState(wallet, wallet.account.address, "eip155:4663");
if (!state.approved && state.ethBalance === 0n) {
  await requestGasGrant("https://facilitator.loxley.dev", wallet.account.address);  // USDG-only wallet
}
await ensurePermit2Approval(wallet, "eip155:4663");   // one on-chain approve, once

const pay = createRobinhoodPayer(wallet, { maxAmountPerPayment: "$1" });
const res = await pay("https://quotes.example/aapl");  // 402s are paid in USDG automatically
```

`createRobinhoodPayer` wraps `@x402/fetch` with the exact EVM scheme registered for 4663 and 46630, pins the RPC the scheme uses for Permit2 nonce and allowance reads, and allow-lists USDG under the client's spend controls (reference clients at 2.24+ reject non-default assets otherwise).

Everything in `@loxley/chain` is re-exported.

Tests: `pnpm test` (router: failover, benching, settle-timeout safety, definitive 4xx, supported merge).
