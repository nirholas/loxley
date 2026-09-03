# @loxley/chain

Robinhood Chain (`eip155:4663`) and its testnet (`eip155:46630`) as data for x402 integrations: viem chain definitions, USDG, Permit2 and the canonical x402 proxy addresses, a strict USD-to-atomic parser, and a money parser that teaches any `@x402/core` resource server what `"$0.01"` means on this chain.

```bash
pnpm add @loxley/chain viem
```

```ts
import { robinhoodChain, USDG_ADDRESS, parseUsdg, registerRobinhoodMoneyParser } from "@loxley/chain";

parseUsdg("$0.01");            // 10000n
registerRobinhoodMoneyParser(server);   // x402ResourceServer: "$0.01" -> { amount: "10000", asset: USDG, extra: { assetTransferMethod: "permit2" } }
```

No network calls. Full reference in [docs/sdk.md](../../docs/sdk.md); chain facts in [docs/robinhood-chain-x402.md](../../docs/robinhood-chain-x402.md).
