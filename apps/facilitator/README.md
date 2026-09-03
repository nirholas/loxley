# @loxley/facilitator

Self-hostable x402 facilitator for Robinhood Chain: `exact` and `upto` schemes over Permit2 on 4663 and 46630, idempotent settles, a SQLite journal, a persisted Bazaar catalog, approval gas grants, and `/health` `/stats` `/metrics`.

```bash
cp ../../.env.example ../../.env     # FACILITATOR_PRIVATE_KEY with ETH on the networks you serve
pnpm start                           # http://localhost:4663
pnpm test                            # unit
pnpm e2e                             # anvil fork of mainnet, real USDG, reference client, verify + settle + replay + gas grant
```

Endpoints, configuration and the exact gas-grant rules: [docs/facilitator.md](../../docs/facilitator.md).
