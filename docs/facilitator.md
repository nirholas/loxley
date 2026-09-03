# Operating a Loxley Facilitator

Source: [apps/facilitator](../apps/facilitator). Built on `@x402/core` + `@x402/evm`; adds persistence, idempotency, discovery, gas grants and metrics.

## Configuration

Every variable has a working default except the key. See [.env.example](../.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | required | Signer. Needs ETH on each served network. |
| `FACILITATOR_NETWORKS` | `eip155:4663,eip155:46630` | Networks to register. |
| `FACILITATOR_PORT` | `4663` | |
| `FACILITATOR_DB` | `./data/facilitator.db` | SQLite (WAL). `:memory:` for tests. |
| `RHC_MAINNET_RPC_URL`, `RHC_TESTNET_RPC_URL` | public RPCs | Use Alchemy/QuickNode in production. |
| `GAS_GRANT_WEI` | `50000000000000` (0.00005 ETH) | ETH sent per approval gas grant. |
| `GAS_GRANT_MIN_USDG` | `1000000` (1 USDG) | Minimum USDG a grantee must hold. |
| `GAS_GRANT_RESERVE_WEI` | `2e15` | Stop granting below this signer balance. |
| `EIP6492_FACTORIES` | empty | Trusted smart-wallet factories for counterfactual payers. |

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Manifest: networks, signer addresses, contract addresses. |
| GET | `/supported` | Reference shape: `kinds`, `extensions`, `signers`. |
| POST | `/verify` | `{ paymentPayload, paymentRequirements }` -> `VerifyResponse`. |
| POST | `/settle` | Same body -> `SettleResponse`. Idempotent on the payload hash: a retry returns the original receipt and sets `X-Loxley-Idempotent-Replay: true`. |
| GET | `/discovery/resources` | Bazaar list. `?q=`, `?type=`, `?limit=`, `?offset=`. Catalogued from sellers that declare the discovery extension, ranked by settled count. |
| POST | `/gas-grant` | `{ address, network? }`. See below. |
| GET | `/health` | Signer balances and head blocks per network; 503 if any signer is empty. |
| GET | `/stats` | Journal aggregates. |
| GET | `/metrics` | Prometheus. |

## Idempotency

The payload hash is SHA-256 over the payment payload with keys sorted at every depth. Before settling, the facilitator looks the hash up; a prior success short-circuits to the stored transaction, so a seller retrying after a network blip never causes a second broadcast (which would fail on Permit2's nonce anyway, but would cost gas and time). Failures are journaled too, with the reason.

## Gas grants

USDG has no EIP-2612, so the one-time Permit2 approval is an on-chain transaction the payer must send. A wallet funded only with USDG (the normal case for an agent that just got paid) cannot send it. `/gas-grant` transfers `GAS_GRANT_WEI` to such a wallet when all of the following hold:

1. valid address, not the facilitator itself;
2. no prior grant to that address on that network (journaled, primary key);
3. USDG balance at least `GAS_GRANT_MIN_USDG`;
4. Permit2 allowance is zero (a grant to an approved wallet is pointless);
5. ETH balance below the grant amount;
6. the facilitator stays above `GAS_GRANT_RESERVE_WEI` after paying.

At 0.32 gwei an approve costs about 0.000015 ETH, so the default grant covers it three times over and a full ETH funds twenty thousand new payers.

## Journal schema

`settlements(payload_hash PK, network, scheme, payer, pay_to, asset, amount, resource, tx_hash, success, error_reason, latency_ms, created_at)`, `verifications(...)`, `resources(resource PK, type, x402_version, accepts_json, last_updated, description, mime_type, service_name, tags_json, icon_url, extensions_json, settle_count)`, `gas_grants(address, network, tx_hash, amount_wei, created_at)`.

## Running it

```bash
pnpm facilitator                          # tsx, from source
pnpm --filter @loxley/facilitator build   # tsc to dist/
node apps/facilitator/dist/src/index.js
```

Put it behind TLS, point `PUBLIC_URL` at it, and register it in the x402 ecosystem directory (`typescript/site/app/ecosystem/partners-data/<name>/metadata.json` upstream) with category `Facilitator`.

## Proving it works

`pnpm --filter @loxley/facilitator e2e` forks mainnet with anvil, funds a payer with USDG by writing its balance slot (slot 1), approves Permit2, boots the facilitator against the fork, builds a payment with the reference `x402Client`, and asserts: verify ok, settle ok with USDG moved payer -> payee, replayed settle returns the same tx without a second debit, stats and metrics reflect it, and a gas grant lands exactly once.
