# Loxley Scan

The x402 settlement explorer for Robinhood Chain.

It indexes `Settled()` and `SettledWithPermit()` from the canonical x402 Permit2 proxies (`0x4020…0001` exact, `0x4020…0002` upto), decodes each `settle()` call for payer, payee, token and amount, confirms the amount against the USDG `Transfer` in the receipt, and records the facilitator (the transaction sender), gas, and status.

```bash
pnpm start          # http://localhost:4664: UI + API, follows the head
pnpm index          # one catch-up pass, then exit (cron-friendly)
pnpm test
```

## API

| Path | Returns |
|---|---|
| `/api/overview` | all-time, 24h and 7d: settlements, volume (atomic USDG), payers, payees, facilitators, gas |
| `/api/settlements?limit&offset&facilitator&payTo&payer` | newest first |
| `/api/settlements/:txHash` | one transaction |
| `/api/facilitators?days`, `/api/payees?days`, `/api/payers?days` | leaderboards |
| `/api/daily?days` | per-UTC-day buckets |
| `/api/status` | head, cursor, lag, last error |

## UI

`/` overview with tiles, a 30-day bar chart, three leaderboards and the latest settlements; `/tx/:hash`; `/address/:address` (as facilitator, payee, payer). Server-rendered, no client JS, readable in both colour schemes.

## Indexing notes

- Cursor advances only up to `head - SCAN_CONFIRMATIONS` (default 20) so reorgs never leave phantom rows.
- `eth_getLogs` windows default to 20k blocks with exponential backoff; the public RPC accepts about 50k. With an Alchemy URL set `SCAN_WINDOW=200000`.
- Rows are keyed by `(tx_hash, log_index)`; re-indexing is idempotent.
- `labels` map known signer addresses to names (Canopy's relayer is seeded). Add more via `db.setLabel`.
