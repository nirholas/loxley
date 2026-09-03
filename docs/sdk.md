# @loxley/chain and @loxley/sdk

## @loxley/chain

Data and helpers, no network calls.

```ts
import {
  ROBINHOOD_CHAIN, ROBINHOOD_CHAIN_TESTNET,        // "eip155:4663", "eip155:46630"
  robinhoodChain, robinhoodChainTestnet,          // viem Chain objects with multicall3
  USDG_ADDRESS, USDG_DECIMALS, TESTNET_USDG_ADDRESS,
  PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY, CREATE2_DEPLOYER,
  ASSETS, RPC_URLS, EXPLORER_URLS,
  parseUsdg, formatUsdg,                           // "$0.01" <-> 10000n, strict (rejects >6 decimals)
  registerRobinhoodMoneyParser,                    // teaches x402ResourceServer what "$0.01" means here
  isRobinhoodNetwork, chainForNetwork, assetForNetwork,
} from "@loxley/chain";
```

`registerRobinhoodMoneyParser(server)` returns `{ amount, asset: USDG, extra: { assetTransferMethod: "permit2" } }` for Robinhood networks and `undefined` for everything else, so it composes with the SDK's own defaults.

## @loxley/sdk

Re-exports everything from `@loxley/chain` and adds:

### FacilitatorRouter

A `FacilitatorClient` (structurally identical to `@x402/core`'s) that spreads a resource server across several facilitators.

```ts
const router = new FacilitatorRouter(
  [
    { url: "https://facilitator.loxley.dev", name: "loxley", priority: 0 },
    { url: "https://facilitator.canopyfinance.io", name: "canopy", priority: 1, headers: { "x-api-key": "..." } },
  ],
  { requireNetwork: "eip155:4663", cooldownMs: 30_000, failureThreshold: 2, onEvent: console.log },
);
await router.refreshSupported();        // optional: warm the network filter
const server = new x402ResourceServer(router);
```

Behaviour:

- **Candidate order**: not benched, advertises the required network in `/supported` (once known), then lowest `priority`, then lowest EWMA latency.
- **Benching**: `failureThreshold` consecutive failures bench a facilitator for `cooldownMs`. If everyone is benched the router tries all of them anyway rather than fail a paying customer on a stale bench.
- **verify** fails over across every candidate; it is a read.
- **settle** fails over only on transport failures that provably happened before the facilitator acted (connection errors, HTTP 5xx). A settle that **times out is not retried** and surfaces as `RouterError`, because the transaction may have landed and the payer must not be charged twice. Pair this with a facilitator that replays receipts (Loxley does) if you want safe retries.
- **4xx** from a facilitator is a definitive answer: it is thrown and not failed over.
- `getSupported()` merges kinds, extensions and signers across facilitators.
- `snapshot()` exposes per-facilitator counters for your dashboards.

`KNOWN_FACILITATORS` lists the facilitators known to serve Robinhood Chain in the order Loxley recommends.

### createRobinhoodPayer(wallet, options?)

Returns a `fetch` that pays 402s in USDG on 4663 and 46630, using the reference exact EVM client. Opens the client's spend controls for USDG only, capped per payment at `options.maxAmountPerPayment` (atomic; default `"1000000"`, $1; `false` for no cap). `options.rpcUrls` overrides the RPC the client uses for Permit2 nonce and allowance reads.

### ensurePermit2Approval(wallet, network) / getApprovalState(client, owner, network)

The one-time approval, and the state read behind it (`approved`, `allowance`, `usdgBalance`, `ethBalance`). `ensurePermit2Approval` returns the tx hash or `null` if already approved, and throws if the receipt is not `success`.

### requestGasGrant(facilitatorUrl, address, network?)

Asks a Loxley facilitator to fund the approval for a wallet that holds USDG but no ETH. See the facilitator docs for the exact qualification rules.
