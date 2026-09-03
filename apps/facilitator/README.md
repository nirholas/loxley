# Loxley Facilitator

Open, self-hostable x402 facilitator for Robinhood Chain. Built on the reference `@x402/core` and `@x402/evm`; adds what a production facilitator needs and the reference examples leave out.

- `exact` and `upto` schemes on `eip155:4663` and `eip155:46630`, USDG over Permit2.
- EIP-2612 and ERC-20 approval gas-sponsoring extensions registered (USDG only supports the latter).
- SQLite journal of every verification and settlement, with latency and failure reason.
- **Idempotent `/settle`**: a retried payload returns the original receipt, never a second broadcast.
- Persisted **Bazaar catalog** at `/discovery/resources`, ranked by settled volume, searchable.
- **`/gas-grant`**: bounded ETH grants so a wallet that only holds USDG can make its one-time Permit2 approval.
- `/health`, `/stats`, Prometheus `/metrics`.

```bash
cp ../../.env.example ../../.env   # set FACILITATOR_PRIVATE_KEY
pnpm start                          # http://localhost:4663
pnpm test                           # unit
pnpm e2e                            # anvil fork of mainnet: verify, settle, replay, gas grant
```

Full operating guide: [docs/facilitator.md](../../docs/facilitator.md).
