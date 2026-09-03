# Loxley contracts

Foundry project. Solc auto-detected per file (LoxleyEscrow at 0.8.28, vendored Permit2 at 0.8.17), `cbor_metadata = false` for reproducible bytecode.

| Contract | Purpose | Address (4663 and 46630) |
|---|---|---|
| `LoxleyEscrow` | per-request USDG escrow with attested release | `0xbE7523F2dd81cF23256342423A3CD898AA4E21E7` |
| `MockUSDG` | testnet USDG with a built-in faucet (`drip()`), refuses mainnet | testnet only, set by deploy |
| ERC-8004 registries (vendored, ChaosChain RI, MIT) | agent identity, reputation, validation | `0x9Cdee67C9A8B7A50503d4487676830bbC2a15E77`, `0x76dbE5d83496beBBad3567Df16dA9CC0AD7CEd4e`, `0x2d712371187Ac16C27B685d730bF6295D0ca9e68` |

All addresses come from the CREATE2 deployer at `0x4e59b44847b379578588920cA78FbF26c0B4956C` with fixed salts, so they are the same on both networks and independent of who deploys.

```bash
forge build
forge test                                   # 13 tests; Permit2 runtime bytecode etched at its canonical address
RHC_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork   # live fork
forge script script/DeployEscrow.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
forge script script/DeployMockUSDG.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
(cd lib/erc-8004 && forge build) && forge script script/DeployAgentRegistries.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
forge script script/FindUsdgSlot.s.sol --rpc-url $RHC_MAINNET_RPC_URL     # balances mapping slot (1), used by the e2e harness
```

Spec and threat model: [docs/escrow.md](../docs/escrow.md).
