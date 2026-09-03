# Upstream: registering USDG on Robinhood Chain in the x402 SDKs

`upstream/x402-robinhood-chain.patch` applies to `x402-foundation/x402` (main, 2026-09-03) and adds `eip155:4663` with USDG as the default asset, following the repo's `DEFAULT_ASSETS.md`:

- `typescript/packages/mechanisms/evm/src/defaultAssets.ts`: `DEFAULT_ASSETS["eip155:4663"]`
- `typescript/packages/mechanisms/evm/src/constants.ts`: `robinhood-chain: 4663` in the chain-id map
- `go/mechanisms/evm/default_assets.go`: `DefaultAssets["eip155:4663"]`
- `python/x402/mechanisms/evm/default_assets.py`: `DEFAULT_ASSETS["eip155:4663"]`
- `docs/core-concepts/network-and-token-support.mdx`: the EVM default-asset table row

Entry: address `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, name `Global Dollar`, version `1`, 6 decimals, symbol `USDG`, `assetTransferMethod: permit2`, no `supportsEip2612` (the token has no `permit`). Go builds and the Python module compiles with the patch applied.

To open the PR from the `nirholas/x402` fork:

```bash
git clone https://github.com/nirholas/x402 && cd x402
git checkout -b robinhood-chain-usdg-default-asset
git apply ../loxley/upstream/x402-robinhood-chain.patch
git commit -am "feat(evm): register USDG as the default asset for Robinhood Chain (eip155:4663)"
git push -u origin robinhood-chain-usdg-default-asset
```

PR body, per the asset-selection policy: USDG is the stablecoin Robinhood Chain launched with and the lending asset in Robinhood Earn; it is natively issued on the chain. Cite the selector check showing no EIP-3009 and no EIP-2612, and the live canonical proxy deployments on 4663 and 46630.

Until it merges, runtime behaviour is covered by `registerRobinhoodMoneyParser()` (servers) and `createRobinhoodPayer()` (clients) in `@loxley/sdk`.
