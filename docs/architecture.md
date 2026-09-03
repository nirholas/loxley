# Architecture

Loxley is five small pieces on one protocol. Nothing here forks x402; every component speaks the reference wire format from `@x402/core` 2.x, so a Loxley facilitator serves any x402 seller and a Loxley payer pays any x402 seller.

```
                 buyer (agent)                          seller (resource server)
                 ─────────────                          ────────────────────────
  @loxley/sdk createRobinhoodPayer  ── 402 / PAYMENT-SIGNATURE ──▶  @x402/core x402ResourceServer
        │  signs Permit2 witness                                      │  FacilitatorRouter (@loxley/sdk)
        │  (USDG, spender = x402ExactPermit2Proxy)                    │     health-scored, benched, failover
        ▼                                                             ▼
   Robinhood Chain 4663                            Loxley Facilitator ── Canopy ── r0x ── (any x402 facilitator)
   USDG ──approve(Permit2)── once                   /verify  simulate + signature + allowance
   Permit2 ◀── proxy.settle() ◀───────────────────  /settle  broadcast, journal, idempotent replay
        │                                            /discovery/resources  Bazaar catalog (SQLite)
        ▼                                            /gas-grant  ETH for a USDG-only wallet's approve
   Loxley Scan indexer ◀── Settled() logs            /metrics  Prometheus
   (SQLite) ──▶ API + UI: volume, facilitators, payees, payers
```

## Trust boundaries

| Component | Holds | Can lose | Cannot do |
|---|---|---|---|
| Payer | USDG, a Permit2 approval | only what each signature permits: exact amount, exact payee, bounded deadline | be redirected: the payee is inside the signed witness and the proxy checks it on-chain |
| Facilitator | an ETH-funded signer | gas, and the ETH it grants | move USDG anywhere except where the payer signed; the proxy enforces `witness.to` |
| Seller | nothing on-chain | a settle that never lands (mitigated by the router's failover and the facilitator's journal) | double-charge: identical payloads replay the first receipt |
| LoxleyEscrow | USDG for open requests | nothing without an attestor receipt or a deadline | be upgraded, paused, or drained by an admin: it has none |
| Scan | a read-only RPC | nothing | anything: it only reads logs |

## Why Permit2 and not EIP-3009

USDG on 4663 is an EIP-1967 proxy whose implementation exposes `DOMAIN_SEPARATOR()` and `mint()` but neither `transferWithAuthorization` nor `permit`. That was checked against the implementation bytecode at `0x68184c449e1a8f34fa18d289737129fd27b66f8f`, not the proxy shell. So the only gasless transfer authorization available is Permit2's `permitWitnessTransferFrom`, which the canonical x402 proxies already wrap. Consequences:

1. A payer needs a one-time on-chain `approve(Permit2, amount)` before any x402 payment. `ensurePermit2Approval` sends it; `/gas-grant` funds it for USDG-only wallets.
2. The `exact` scheme's `extra.assetTransferMethod` must be `"permit2"` on every 402, or reference clients try EIP-3009 and fail at the signature step. `registerRobinhoodMoneyParser` sets it.
3. Reference clients at `@x402/core` 2.24+ apply spend controls that reject non-default assets. Until the upstream registration PR lands, `createRobinhoodPayer` allow-lists USDG per network.

## Data flow of one payment

1. Seller returns `402` with `accepts: [{ scheme: "exact", network: "eip155:4663", asset: USDG, amount, payTo, extra: { assetTransferMethod: "permit2" } }]`.
2. Buyer signs `PermitWitnessTransferFrom` with `spender = x402ExactPermit2Proxy` and `witness = { to: payTo, validAfter }`.
3. Seller calls the router's `verify`. The router picks the healthiest facilitator; the facilitator checks signature, allowance, balance, and simulates `settle`.
4. Seller serves the response, then calls `settle`. The facilitator broadcasts `proxy.settle(permit, owner, witness, sig)`, waits for the receipt, journals it, and returns the tx hash. A retry with the same payload returns the same hash without a second broadcast.
5. The proxy emits `Settled()`; USDG emits `Transfer(payer, payTo, amount)`. Loxley Scan picks both up within one poll interval.

## What each piece stores

- Facilitator (SQLite, WAL): `settlements`, `verifications`, `resources` (Bazaar), `gas_grants`.
- Scan (SQLite, WAL): `settlements` keyed by `(tx_hash, log_index)`, `cursors`, `labels`.
- Escrow (chain): one `Lock` per `requestId`.

Both databases are single files and can be rebuilt: the facilitator's from its own logs, Scan's from the chain.
