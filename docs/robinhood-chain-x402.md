# x402 on Robinhood Chain

Verified against the live chain on 2026-09-03. Every address below was read from the chain, not copied from a blog.

## Network

| | Mainnet | Testnet |
|---|---|---|
| CAIP-2 | `eip155:4663` | `eip155:46630` |
| Chain ID | 4663 | 46630 |
| Stack | Arbitrum Orbit (Nitro), blobs to Ethereum for DA | same |
| Gas token | ETH | ETH |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://robinhoodchain-testnet.blockscout.com` |
| Mempool | none public; the sequencer feed is the only pre-execution view | same |

The public RPC rate-limits `eth_getLogs` (a 50k-block window works, 1M does not) and returns `Too Many Requests` under bursts. Use Alchemy, QuickNode, Chainstack or dRPC for anything that indexes.

## The payment token

USDG (Global Dollar, issued by Paxos) at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals, EIP-1967 proxy (implementation `0x68184c449e1a8f34fa18d289737129fd27b66f8f`).

What the implementation bytecode exposes, checked by selector:

| Function | Present |
|---|---|
| `transferWithAuthorization` (EIP-3009) | no |
| `receiveWithAuthorization` (EIP-3009) | no |
| `permit` (EIP-2612) | no |
| `DOMAIN_SEPARATOR` | yes |
| `mint` | yes |

Consequences for x402:

1. The only gasless signing path is **Permit2 `permitWitnessTransferFrom`**. Every facilitator on this chain settles through Permit2.
2. The payer needs a **one-time on-chain `approve(Permit2)`**. There is no EIP-2612 permit to sponsor, so the reference SDK's EIP-2612 gas-sponsoring extension does nothing here; the ERC-20 approval extension only broadcasts a transaction the payer already signed and pays gas for. A wallet that holds USDG and no ETH cannot self-onboard, which is what the Loxley facilitator's `/gas-grant` endpoint exists for.
3. USDG is not a registered default asset in the published x402 SDKs (as of `@x402/core` 2.24), so a reference client rejects a 4663 quote with `spendControls` unless the asset is allow-listed. `@loxley/sdk` does that for you; the upstream registration (commit `d14d260` in `x402-foundation/x402`) fixes it at the source once released.

Testnet has no USDG at the mainnet address. `contracts/src/MockUSDG.sol` is the testnet stand-in: same name, symbol and decimals, same absence of EIP-3009/EIP-2612, plus a `drip()` faucet.

## Canonical contracts, live on both networks

| Contract | Address | Notes |
|---|---|---|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Uniswap canonical |
| `x402ExactPermit2Proxy` | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` | audited (Cantina, Feb 2026); the `exact` scheme's spender |
| `x402UptoPermit2Proxy` | `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002` | the `upto` scheme's spender |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | |
| Arachnid CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | what every Loxley deploy script uses |

Because the proxies are already deployed, **any facilitator built on `@x402/evm` can settle on 4663 today** by registering `eip155:4663` with a funded signer. Loxley's facilitator is exactly that plus the operational layer.

## What a settlement costs

From mainnet tx `0x2bc1f32b553d820c3b7929ba50ccee2ffe23da826d1caf8a7590aa3a6ee66577` (an `exact` settle of 0.01 USDG):

| | |
|---|---|
| Gas used | 101,851 |
| Effective gas price | 0.321 gwei |
| Fee | 0.0000327 ETH |
| Events | USDG `Transfer(payer, payee, 10000)`, proxy `Settled()` |

The facilitator pays that fee. At the time of writing the Exact proxy had 11,693 settlement transactions, almost all from a single facilitator signer, at a cadence of roughly one a minute.

## A trap for test harnesses: well-known keys are EIP-7702 delegated here

The anvil/hardhat default accounts (`0xf39F…2266`, `0x7099…79C8`, `0x3C44…93BC`, ...) carry an EIP-7702 delegation on Robinhood Chain mainnet (`eth_getCode` returns `0xef0100…8a5b10eb2faf57665f63709ec4b3943a3b005df6`). Their private keys are public, so a bot set delegations for them. Permit2 sees non-empty code, treats the payer as a contract and calls `isValidSignature()`, which the delegate does not implement, and the settle reverts with no data. Any fork-based test that pays from those addresses fails with `invalid_permit2_signature` even though the signature is fine. Generate fresh keys per run (`generatePrivateKey()` from viem); the Loxley e2e does.

## Who is already here

| Name | What | Scheme |
|---|---|---|
| Canopy | hosted facilitator, `facilitator.canopyfinance.io` | `exact-permit2-v2`, its own relayer contract `0x43A047aE20bd92eD3a37610062b48Dc314fD17Ff` and a `serviceId` witness |
| r0x | hosted facilitator + SDK | Permit2 |
| Hood x402 | paid-endpoint builder + hosted facilitator | Permit2 (site says EIP-3009; USDG has none) |
| x402hood | audit / budget proxy in front of facilitators | |
| AgentOS, Aeron, HISS | agent wallets and control planes | |

Loxley Scan indexes the canonical proxies, which is where every reference-SDK facilitator settles. Canopy's relayer uses a different contract and is labelled but not decoded in v0.1.
