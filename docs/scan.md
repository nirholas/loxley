# Loxley Scan

The x402 settlement explorer for Robinhood Chain.

## What it indexes

Every `Settled()` and `SettledWithPermit()` event on the canonical proxies (`x402ExactPermit2Proxy` `0x4020…0001`, `x402UptoPermit2Proxy` `0x4020…0002`). For each event it fetches the transaction and receipt and decodes:

| Field | Source |
|---|---|
| scheme | which proxy was called |
| facilitator | `tx.from` |
| payer | `settle(...)` calldata `owner` |
| payee | calldata `witness.to` |
| token, permitted amount | calldata `permit.permitted` |
| settled amount | the `Transfer(payer, payee, x)` log of that token in the receipt (falls back to the permitted amount for `exact`, `settlementAmount` for `upto`) |
| with_permit | whether the event was `SettledWithPermit` |
| gas used, effective gas price, status | receipt |

Facilitators that use their own settlement contract (Canopy's relayer) are labelled but not decoded in v0.1.

## Run it

```bash
pnpm --filter @loxley/scan index    # catch up once and exit
pnpm scan                           # follow the head and serve the UI/API
```

| Variable | Default | Meaning |
|---|---|---|
| `SCAN_NETWORK` | `eip155:4663` | |
| `SCAN_DB` | `./data/scan.db` | |
| `SCAN_PORT` | `4664` | |
| `SCAN_START_BLOCK` | `48000000` (mainnet) | First block to scan. Lower it if you want older history; the proxies had no traffic before mid-2026. |
| `SCAN_WINDOW` | `20000` | `eth_getLogs` window. The public RPC accepts 50k; a provider accepts much more. |
| `SCAN_POLL_MS` | `4000` | Head poll once caught up. |
| `SCAN_CONFIRMATIONS` | `20` | Blocks behind head the cursor stays. |

The indexer is cursor-based and every insert is `INSERT OR IGNORE` on `(tx_hash, log_index)`, so restarts and overlaps are safe. Log queries back off exponentially on `Too Many Requests`.

## API

| Path | Returns |
|---|---|
| `/api/status` | head, cursor, lag, last error, indexing flag |
| `/api/overview` | all-time / 24h / 7d: count, volume (atomic USDG), distinct payers, payees, facilitators, gas spent; failed count; first and latest settlement |
| `/api/daily?days=30` | UTC daily buckets: count, volume, payers |
| `/api/settlements?limit&offset&facilitator&payTo&payer` | newest first |
| `/api/settlements/:txHash` | every settlement log in that tx |
| `/api/facilitators`, `/api/payees`, `/api/payers` (`?days=`) | leaderboards: count, volume, counterparties, first and last seen |
| `/api/labels` | known address labels |

## UI

Server-rendered from the same database, no build step: `/` (tiles, 30-day chart, leaderboards, latest settlements), `/tx/:hash`, `/address/:address` (split by role: facilitator, payee, payer). Reads the viewer's colour scheme.
