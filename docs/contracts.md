# Contracts

Foundry project in `contracts/`. `forge test` runs against the real Permit2 runtime bytecode captured from Robinhood Chain (`test/deps/Permit2.runtime.hex`, etched at the canonical address), and `LoxleyEscrow.fork.t.sol` runs against a live fork with real USDG when `RHC_MAINNET_RPC_URL` is set.

```bash
cd contracts
forge build
forge test -vv
RHC_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork -vv
```

Dependencies are git submodules: forge-std v1.16.2, OpenZeppelin v5.7.0, Uniswap Permit2, and the ERC-8004 reference implementation (ChaosChain, MIT) with its own OpenZeppelin v4 under `lib/erc-8004/lib`.

## LoxleyEscrow

Per-request escrow for x402 with an attested release. Immutable: no owner, no upgrade, no pause. Constructor: `(permit2, feeBps ≤ 500, feeRecipient)`.

```
open(PermitTransferFrom permit, address payer, EscrowWitness witness, bytes signature)
release(Receipt receipt, bytes attestorSignature)     receipt.accepted must be true  -> payee, minus fee
refund(Receipt receipt, bytes attestorSignature)      receipt.accepted must be false -> payer
reclaim(bytes32 requestId)                            after witness.deadline, anyone -> payer
getLock(requestId), receiptDigest(receipt), domainSeparator()
```

`EscrowWitness(bytes32 requestId, address payee, address attestor, uint64 deadline, bytes32 schemaHash)` is the Permit2 witness the payer signs, with `spender = LoxleyEscrow`. The Permit2 witness type string is

```
EscrowWitness witness)EscrowWitness(bytes32 requestId,address payee,address attestor,uint64 deadline,bytes32 schemaHash)TokenPermissions(address token,uint256 amount)
```

`Receipt(bytes32 requestId, bytes32 responseHash, uint16 status, bool accepted)` is signed by the attestor under the contract's own EIP-712 domain (`LoxleyEscrow`, `1`). EOA and ERC-1271 attestors both work (`SignatureChecker`). A receipt is single-use because the lock leaves `Open` on first use.

Events: `Opened`, `Released`, `Refunded`, `Reclaimed`. Errors are typed (`RequestExists`, `NotOpen`, `NotExpired`, `BadReceipt`, `ReceiptVerdictMismatch`, `DeadlinePassed`, `InvalidAmount`, ...).

Facilitator integration: the facilitator is the natural attestor. It fronts the call, hashes the response, checks it against `schemaHash`, and signs `accepted = status < 500 && schemaOk`. Anyone can submit the receipt; the payer never spends gas.

Deploy (deterministic, same address on 4663 and 46630):

```bash
DEPLOYER_PRIVATE_KEY=0x... ESCROW_FEE_BPS=0 forge script script/DeployEscrow.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
```

Expected address with the default salt and zero fee: `0xbE7523F2dd81cF23256342423A3CD898AA4E21E7`.

## MockUSDG

Testnet stand-in for USDG. `ERC20("Global Dollar", "USDG")`, 6 decimals, no EIP-3009, no EIP-2612. `drip()` mints 1,000 USDG to the caller once per 24 hours; `mint(to, amount)` is owner-only. `DeployMockUSDG.s.sol` refuses to run on chain 4663.

## ERC-8004 registries

`DeployAgentRegistries.s.sol` deploys the reference `IdentityRegistry`, `ReputationRegistry(identity)` and `ValidationRegistry(identity)` through the Arachnid CREATE2 deployer using the bytecode produced by the reference repo's own toolchain (`cd lib/erc-8004 && forge build`), so the deployment is byte-identical to upstream and the addresses are the same on both networks:

| Registry | Address |
|---|---|
| IdentityRegistry | `0x9Cdee67C9A8B7A50503d4487676830bbC2a15E77` |
| ReputationRegistry | `0x76dbE5d83496beBBad3567Df16dA9CC0AD7CEd4e` |
| ValidationRegistry | `0x2d712371187Ac16C27B685d730bF6295D0ca9e68` |

## Storage facts used by the tests

USDG's `balanceOf` mapping lives at slot 1 of the proxy (found with `script/FindUsdgSlot.s.sol`), so `keccak256(abi.encode(holder, 1))` is the balance slot for `holder`. The anvil e2e uses that to fund payers.
