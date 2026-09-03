# Upstream: make eip155:4663 a first-class x402 network

The x402 reference SDKs keep a per-chain default-asset table. A chain in that table gets `"$0.01"` pricing for free, appears in the Bazaar's network list, and, since `@x402/core` 2.24, is accepted by client spend controls without an allow-list. Robinhood Chain is not in it. The practical effect today: a stock `x402Client` refuses a USDG 402 with `All payment requirements were rejected by spendControls`.

The branch `robinhood-chain-usdg-default-asset` on the `nirholas/x402` fork adds the entry to all three registries and the docs, following [DEFAULT_ASSETS.md](https://github.com/x402-foundation/x402/blob/main/DEFAULT_ASSETS.md):

| SDK | File | Entry |
|---|---|---|
| TypeScript | `typescript/packages/mechanisms/evm/src/defaultAssets.ts` | `"eip155:4663": [{ asset: USDG, name: "Global Dollar", version: "1", decimals: 6, symbol: "USDG", assetTransferMethod: "permit2" }]` |
| TypeScript | `typescript/packages/mechanisms/evm/src/constants.ts` | `robinhood: 4663`, `"robinhood-testnet": 46630` in the chain-name map |
| Go | `go/mechanisms/evm/default_assets.go`, `constants.go` | same entry, `ChainIDRobinhood` |
| Python | `python/x402/mechanisms/evm/default_assets.py` | same entry |
| Docs | `docs/core-concepts/network-and-token-support.mdx` | table row |

Rationale in the commit: USDG is the chain's natively issued stablecoin and the lending asset in Robinhood Earn; it is the settlement asset every facilitator on the chain uses; it implements neither EIP-3009 nor EIP-2612 (checked against the implementation bytecode), hence `permit2` with no `supportsEip2612`; Permit2 and both canonical proxies are live at their canonical addresses; the exact proxy has more than 11k settlements.

The testnet entry is deliberately absent until the `MockUSDG` faucet token is deployed to 46630 and its address is stable.

Open the PR from the fork: https://github.com/nirholas/x402/pull/new/robinhood-chain-usdg-default-asset

Until it merges, `registerRobinhoodMoneyParser` (sellers) and `createRobinhoodPayer` (buyers) in this repo do the same job at runtime.
