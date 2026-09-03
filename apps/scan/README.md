# @loxley/scan

Loxley Scan, the x402 settlement explorer for Robinhood Chain. Indexes every `settle()` / `settleWithPermit()` on the canonical x402 Permit2 proxies, decodes facilitator, payer, payee and amount, and serves a JSON API plus a server-rendered UI.

```bash
pnpm index     # one catch-up pass
pnpm start     # follow the head and serve http://localhost:4664
pnpm test
```

Set `RHC_MAINNET_RPC_URL` to a provider URL for a fast backfill; the public RPC works with the default 20k-block window. API and UI reference: [docs/scan.md](../../docs/scan.md).
