# @loxley/sdk

x402 on Robinhood Chain for both sides of a payment.

- `FacilitatorRouter`: a drop-in `FacilitatorClient` that spreads a resource server across several facilitators with health scoring, benching and settle-safe failover.
- `createRobinhoodPayer(wallet)`: a `fetch` that pays 402s in USDG on 4663/46630 with the reference exact EVM client, spend controls opened for USDG.
- `ensurePermit2Approval`, `getApprovalState`, `requestGasGrant`: the one-time Permit2 approval USDG needs, and the facilitator gas grant for wallets that cannot pay for it.

```bash
pnpm add @loxley/sdk @x402/core @x402/evm @x402/fetch viem
```

```ts
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { FacilitatorRouter, KNOWN_FACILITATORS, registerRobinhoodMoneyParser } from "@loxley/sdk";

const server = new x402ResourceServer(new FacilitatorRouter(KNOWN_FACILITATORS, { requireNetwork: "eip155:4663" }));
server.register("eip155:*", new ExactEvmScheme());
registerRobinhoodMoneyParser(server);
```

Full reference in [docs/sdk.md](../../docs/sdk.md). Tests: `pnpm test` (router failover, benching, settle timeout semantics, /supported merging).
