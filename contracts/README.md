# Loxley contracts

- `src/LoxleyEscrow.sol`: per-request x402 escrow funded by a Permit2 witness transfer, released or refunded by an attestor's EIP-712 receipt, reclaimable by the payer after the deadline. No admin, no upgrade.
- `src/MockUSDG.sol`: testnet USDG with a `drip()` faucet. Mirrors mainnet USDG's lack of EIP-3009 and EIP-2612.
- `script/DeployEscrow.s.sol`, `script/DeployMockUSDG.s.sol`, `script/DeployAgentRegistries.s.sol` (ERC-8004 reference registries): deterministic CREATE2 deploys, same addresses on 4663 and 46630.
- `script/FindUsdgSlot.s.sol`: finds USDG's balance storage slot on a fork (used by the facilitator e2e).

```bash
forge build
forge test -vv                                                              # real Permit2 bytecode, etched
RHC_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork -vv
(cd lib/erc-8004 && forge build)                                            # once, before deploying the registries
DEPLOYER_PRIVATE_KEY=0x... forge script script/DeployEscrow.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
```

Interfaces, witness and receipt types, addresses: [docs/contracts.md](../../docs/contracts.md).
