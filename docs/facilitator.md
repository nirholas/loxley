# Loxley facilitator

A self-hostable x402 facilitator for Robinhood Chain, built on `@x402/core` and `@x402/evm`. One process, one signer key, SQLite on disk.

## Run it

```bash
cp .env.example .env
# FACILITATOR_PRIVATE_KEY=0x...   the signer; needs ETH on every network it serves
pnpm facilitator
```

| Variable | Default | Meaning |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | required | Settles transactions and pays gas. Keep ETH on it. |
| `FACILITATOR_NETWORKS` | `eip155:4663,eip155:46630` | Networks to register. Only Robinhood Chain networks are accepted. |
| `FACILITATOR_PORT` | `4663` | |
| `FACILITATOR_DB` | `./data/facilitator.db` | SQLite journal + catalog. `:memory:` for tests. |
| `RHC_MAINNET_RPC_URL` / `RHC_TESTNET_RPC_URL` | public RPCs | Use a provider URL in production. |
| `GAS_GRANT_WEI` | `50000000000000` (0.00005 ETH) | ETH sent per approval gas grant. |
| `GAS_GRANT_MIN_USDG` | `1000000` (1 USDG) | Minimum USDG a wallet must hold to receive a grant. |
| `GAS_GRANT_RESERVE_WEI` | `2000000000000000` (0.002 ETH) | Grants stop when the signer would drop below this. |
| `EIP6492_FACTORIES` | empty | Comma-separated smart-wallet factories allowed for counterfactual deploys. Empty disables. |

## Endpoints

| Method | Path | What |
|---|---|---|
| GET | `/` | Manifest: networks, signer addresses, contract addresses, endpoints. |
| GET | `/supported` | The reference `getSupported()` response: kinds (`exact`, `upto` per network), extensions, signers. |
| POST | `/verify` | `{ paymentPayload, paymentRequirements }` → `VerifyResponse`. |
| POST | `/settle` | `{ paymentPayload, paymentRequirements }` → `SettleResponse`. Idempotent (below). |
| GET | `/discovery/resources` | Bazaar catalog. Query: `type`, `q`, `limit` (≤100), `offset`. Ordered by settle count. |
| POST | `/gas-grant` | `{ address, network? }` → funds one `approve(Permit2)` for a qualifying wallet. |
| GET | `/health` | Per-network signer balance and block height; 503 when any signer is empty. |
| GET | `/stats` | Counters and settled volume by asset. |
| GET | `/metrics` | The same as Prometheus text. |

## What the reference facilitator does not do, and this one does

**Idempotent settle.** Every settle is keyed on a SHA-256 of the payment payload with object keys sorted at every depth (`canonicalJson`). A second `/settle` with the same signed payload returns the original `SettleResponse` with `X-Loxley-Idempotent-Replay: true` and never re-broadcasts. Inside the reference lifecycle the same check runs in `onBeforeSettle`, so a race between two identical requests resolves to one transaction.

**Journal.** `verifications` and `settlements` tables record network, scheme, payer, payee, asset, amount, resource URL, tx hash, outcome and latency for every call. `/stats` and `/metrics` read from them.

**Persisted discovery catalog.** When a verified payment carries the Bazaar discovery extension, the resource is upserted into `resources` and served from `/discovery/resources`, with `settle_count` incremented on each successful settle so the most-used endpoints rank first.

**Approval gas grants.** USDG has no EIP-2612, so a fresh wallet needs an on-chain `approve(Permit2)` and ETH to pay for it. `POST /gas-grant` sends `GAS_GRANT_WEI` when all of the following hold: the address is valid and not the signer; no prior grant exists for that address on that network; the wallet holds at least `GAS_GRANT_MIN_USDG`; its Permit2 allowance is zero; its ETH balance is below the grant; the signer keeps `GAS_GRANT_RESERVE_WEI` after paying. Refusals return `400` with a `reason` from `invalid_address`, `insufficient_usdg`, `already_approved`, `has_gas`, `facilitator_reserve`, `unsupported_network`.

**ERC-20 approval gas sponsoring.** Registered with a per-network signer, so a client that pre-signs its own `approve()` can have the facilitator broadcast it ahead of settlement (the reference extension). The EIP-2612 extension is also registered for completeness; it has nothing to do on USDG.

## Testing

```bash
pnpm --filter @loxley/facilitator test    # config, canonical hashing, journal, catalog, grants
pnpm --filter @loxley/facilitator e2e     # anvil fork of mainnet; see scripts/e2e.ts
```

The e2e forks Robinhood Chain, writes a USDG balance into the payer's storage slot (slot 1 of the proxy), funds ETH, approves Permit2, boots the facilitator in-process against the fork, builds a payment with the reference `x402Client` + `registerExactEvmScheme`, and asserts: `/verify` valid, `/settle` moves exactly 0.01 USDG payer → payee, a replayed `/settle` returns the same receipt without a second debit, `/stats` and `/metrics` reflect it, and `/gas-grant` funds a fresh USDG holder once.

## Operating notes

- Keep two signers if you serve both networks from one process? No: one key works on both, balances are per chain. Fund it on each.
- The public RPC is enough for a low-volume facilitator. Verification simulates the settle; settlement waits for the receipt. Expect roughly 1 to 3 seconds per settle at Robinhood Chain block times.
- Back up `FACILITATOR_DB`. Losing it does not lose funds, but it does lose idempotency history and the catalog.
