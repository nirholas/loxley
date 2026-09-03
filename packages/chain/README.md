# @loxley/chain

Robinhood Chain for x402, as constants and helpers. Zero runtime dependencies beyond `viem` (peer).

```ts
import {
  robinhoodChain, robinhoodChainTestnet,           // viem chain definitions (4663 / 46630)
  ROBINHOOD_CHAIN, ROBINHOOD_CHAIN_TESTNET,        // "eip155:4663" / "eip155:46630"
  USDG_ADDRESS, PERMIT2_ADDRESS,
  X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY,
  parseUsdg, formatUsdg,                           // "$0.01" <-> 10000n
  registerRobinhoodMoneyParser,                    // teach an x402ResourceServer what "$0.01" means here
  assetForNetwork, chainForNetwork, isRobinhoodNetwork,
} from "@loxley/chain";
```

## Money parser

Reference x402 servers turn `"$0.01"` into an asset amount through a per-chain default-asset table. Robinhood Chain is not in that table yet ([upstream PR](../../docs/upstream-pr.md)). Until it is:

```ts
import { x402ResourceServer } from "@x402/core/server";
import { registerRobinhoodMoneyParser } from "@loxley/chain";

const server = new x402ResourceServer(facilitatorClient);
registerRobinhoodMoneyParser(server);
// routes priced as "$0.01" on eip155:4663 now resolve to
// { amount: "10000", asset: USDG, extra: { assetTransferMethod: "permit2" } }
```

The `extra.assetTransferMethod: "permit2"` hint is load-bearing: USDG has no EIP-3009, so without it reference clients try to sign a `transferWithAuthorization` the token cannot execute.

## parseUsdg

Exact: rejects more than six fractional digits instead of rounding, so a price never silently becomes a different price.

```ts
parseUsdg("$0.01")     // 10000n
parseUsdg("0.000001")  // 1n
parseUsdg("0.0000001") // throws
```

## Facts encoded here

USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals, EIP-1967 proxy, no EIP-3009, no EIP-2612). Permit2 and both x402 Permit2 proxies at their canonical addresses on both networks. Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`. `TESTNET_USDG_ADDRESS` is the Loxley `MockUSDG` faucet token and is filled in by the testnet deploy.

Tests: `pnpm test`.
