import { formatUsdg } from "@loxley/chain";
import type { ScanConfig } from "./config.js";
import type { Settlement } from "./db.js";
import type { IndexerStatus } from "./indexer.js";

type Labels = Record<string, { label: string; kind: string }>;
type Leader = { address: string; count: number; volume: string; first_seen: number; last_seen: number; counterparties: number };
type Bucket = { count: number; volume: number; payers: number; payees: number; facilitators: number; gas_wei: number };
type Overview = { all: Bucket; day: Bucket; week: Bucket; failed: number; firstSettlement: { t: number | null; b: number | null }; latestSettlement: { t: number | null; b: number | null } };

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (t: number) => {
  const s = Math.max(Math.floor(Date.now() / 1000) - t, 0);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const usd = (atomic: number | string | bigint) => `$${Number(formatUsdg(BigInt(atomic))).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const eth = (wei: number | bigint) => `${(Number(wei) / 1e18).toFixed(5)} ETH`;

function addr(a: string, labels: Labels, kind?: string): string {
  const l = labels[a.toLowerCase()];
  const text = l ? `${esc(l.label)}` : short(a);
  return `<a class="addr ${kind ?? ""}" href="/address/${a}" title="${a}">${text}</a>`;
}

const STYLE = `
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--ink:#e6e8ee;--dim:#8b93a3;--green:#4fd18b;--amber:#f0b35b;--red:#ef6b6b;--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--sans:"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme: light){:root{--bg:#f5f6f8;--panel:#fff;--line:#e1e4ea;--ink:#12151b;--dim:#5e6675;--green:#177a4a;--amber:#a9640f;--red:#c43d3d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans)}
a{color:inherit}.wrap{max-width:1180px;margin:0 auto;padding:24px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:22px}
header h1{font-size:22px;margin:0;letter-spacing:-.01em}header h1 a{text-decoration:none}header .sub{color:var(--dim);font-size:13px}
.status{font-family:var(--mono);font-size:12px;color:var(--dim)}.status b{color:var(--green)}.status.lag b{color:var(--amber)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:0 0 24px}
.tile{background:var(--panel);padding:14px 16px}.tile .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}.tile .v{font-family:var(--mono);font-size:22px;margin-top:4px;font-variant-numeric:tabular-nums}.tile .d{font-size:12px;color:var(--dim)}
h2{font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:28px 0 10px}
table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--panel);border:1px solid var(--line)}
th{text-align:left;font-weight:600;color:var(--dim);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:9px 12px;border-bottom:1px solid var(--line)}
td{padding:9px 12px;border-bottom:1px solid var(--line);white-space:nowrap;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-family:var(--mono)}.addr{font-family:var(--mono);text-decoration:none;border-bottom:1px dotted var(--dim)}.addr:hover{border-bottom-style:solid}
.ok{color:var(--green)}.bad{color:var(--red)}.dim{color:var(--dim)}.scroll{overflow-x:auto}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px}
.chart{background:var(--panel);border:1px solid var(--line);padding:12px}svg text{fill:var(--dim);font-family:var(--mono);font-size:10px}
footer{margin-top:36px;color:var(--dim);font-size:12px;font-family:var(--mono);border-top:1px solid var(--line);padding-top:12px}
.pill{display:inline-block;font-family:var(--mono);font-size:11px;padding:1px 6px;border:1px solid var(--line);border-radius:3px;color:var(--dim)}
`;

function shell(title: string, body: string, cfg: ScanConfig, status?: IndexerStatus): string {
  const lagging = status ? status.lag > 200 : false;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"><style>${STYLE}</style></head>
<body><div class="wrap"><header><div><h1><a href="/">Loxley Scan</a></h1><div class="sub">x402 settlements on Robinhood Chain (${esc(cfg.network)})</div></div>
${status ? `<div class="status ${lagging ? "lag" : ""}">head <b>${status.head.toLocaleString()}</b> · cursor <b>${status.cursor.toLocaleString()}</b> · lag <b>${status.lag}</b>${status.lastError ? ` · <span class="bad">${esc(status.lastError.slice(0, 80))}</span>` : ""}</div>` : ""}
</header>${body}<footer>Loxley Scan indexes settle() and settleWithPermit() on the canonical x402 Permit2 proxies (exact 0x4020…0001, upto 0x4020…0002). JSON at <a href="/api">/api</a>. Source: github.com/nirholas/loxley</footer></div></body></html>`;
}

function chart(daily: Array<{ day: number; count: number; volume: string }>): string {
  if (daily.length === 0) return `<div class="chart dim">No settlements in the last 30 days.</div>`;
  const w = 560, h = 160, pad = 28;
  const max = Math.max(...daily.map((d) => d.count), 1);
  const bw = (w - pad * 2) / daily.length;
  const bars = daily
    .map((d, i) => {
      const bh = ((h - pad * 2) * d.count) / max;
      const x = pad + i * bw;
      const y = h - pad - bh;
      return `<rect x="${x + 1}" y="${y}" width="${Math.max(bw - 2, 1)}" height="${bh}" fill="var(--green)" opacity=".85"><title>${new Date(d.day * 1000).toISOString().slice(0, 10)}: ${d.count} settlements, ${usd(d.volume)}</title></rect>`;
    })
    .join("");
  const first = new Date(daily[0]!.day * 1000).toISOString().slice(5, 10);
  const last = new Date(daily.at(-1)!.day * 1000).toISOString().slice(5, 10);
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Settlements per day">
<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--line)"/>
<text x="${pad}" y="${pad - 8}">${max} / day</text><text x="${pad}" y="${h - 8}">${first}</text><text x="${w - pad}" y="${h - 8}" text-anchor="end">${last}</text>${bars}</svg></div>`;
}

function settlementsTable(rows: Settlement[], labels: Labels): string {
  if (rows.length === 0) return `<p class="dim">Nothing indexed yet.</p>`;
  return `<div class="scroll"><table><thead><tr><th>Tx</th><th>When</th><th>Scheme</th><th>Facilitator</th><th>Payer</th><th>Payee</th><th class="num">USDG</th><th class="num">Gas</th><th>Status</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr><td><a class="addr" href="/tx/${r.tx_hash}">${short(r.tx_hash)}</a></td><td title="${new Date(r.block_time * 1000).toISOString()}">${ago(r.block_time)}</td><td><span class="pill">${r.scheme}${r.with_permit ? "+permit" : ""}</span></td><td>${addr(r.facilitator, labels, "fac")}</td><td>${addr(r.payer, labels)}</td><td>${addr(r.pay_to, labels)}</td><td class="num">${formatUsdg(BigInt(r.settled_amount))}</td><td class="num dim">${eth(BigInt(r.gas_used) * BigInt(r.gas_price))}</td><td class="${r.status ? "ok" : "bad"}">${r.status ? "ok" : "failed"}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function leaderTable(rows: Leader[], labels: Labels, who: string): string {
  if (rows.length === 0) return `<p class="dim">No ${who} yet.</p>`;
  return `<div class="scroll"><table><thead><tr><th>${who}</th><th class="num">Settlements</th><th class="num">USDG</th><th class="num">Counterparties</th><th>Last</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${addr(r.address, labels)}</td><td class="num">${r.count.toLocaleString()}</td><td class="num">${formatUsdg(BigInt(r.volume))}</td><td class="num">${r.counterparties}</td><td>${ago(r.last_seen)}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

export function renderPage(p: {
  cfg: ScanConfig; explorer: string; status: IndexerStatus; overview: Overview; daily: Array<{ day: number; count: number; volume: string; payers: number }>;
  facilitators: Leader[]; payees: Leader[]; payers: Leader[]; recent: Settlement[]; labels: Labels;
}): string {
  const o = p.overview;
  const tile = (k: string, v: string, d?: string) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ""}</div>`;
  const body = `
<div class="tiles">
${tile("Settlements", o.all.count.toLocaleString(), `${o.day.count.toLocaleString()} in 24h · ${o.week.count.toLocaleString()} in 7d`)}
${tile("Volume", usd(o.all.volume), `${usd(o.day.volume)} in 24h`)}
${tile("Payers", o.all.payers.toLocaleString(), `${o.day.payers} active in 24h`)}
${tile("Payees", o.all.payees.toLocaleString(), `${o.day.payees} active in 24h`)}
${tile("Facilitators", o.all.facilitators.toLocaleString(), `${o.day.facilitators} active in 24h`)}
${tile("Gas spent", eth(o.all.gas_wei), `${o.failed} failed settles`)}
</div>
<h2>Settlements per day</h2>${chart(p.daily)}
<div class="grid2"><div><h2>Facilitators</h2>${leaderTable(p.facilitators, p.labels, "Facilitator")}</div><div><h2>Top payees</h2>${leaderTable(p.payees, p.labels, "Payee")}</div></div>
<h2>Top payers</h2>${leaderTable(p.payers, p.labels, "Payer")}
<h2>Latest settlements</h2>${settlementsTable(p.recent, p.labels)}`;
  return shell("Loxley Scan", body, p.cfg, p.status);
}

export function renderTx(p: { cfg: ScanConfig; explorer: string; rows: Settlement[]; labels: Labels }): string {
  if (p.rows.length === 0) return shell("Not indexed", `<p>That transaction is not an indexed x402 settlement (yet). <a href="/">Back</a></p>`, p.cfg);
  const r = p.rows[0]!;
  const body = `<h2>Settlement</h2><div class="scroll"><table><tbody>
<tr><th>Tx</th><td><a class="addr" href="${p.explorer}/tx/${r.tx_hash}">${r.tx_hash}</a></td></tr>
<tr><th>Block</th><td>${r.block_number.toLocaleString()} · ${new Date(r.block_time * 1000).toISOString()}</td></tr>
<tr><th>Scheme</th><td>${r.scheme}${r.with_permit ? " (settleWithPermit)" : ""} via proxy ${r.proxy}</td></tr>
<tr><th>Facilitator</th><td>${addr(r.facilitator, p.labels)} <span class="dim">${r.facilitator}</span></td></tr>
<tr><th>Payer</th><td>${addr(r.payer, p.labels)} <span class="dim">${r.payer}</span></td></tr>
<tr><th>Payee</th><td>${addr(r.pay_to, p.labels)} <span class="dim">${r.pay_to}</span></td></tr>
<tr><th>Amount</th><td>${formatUsdg(BigInt(r.settled_amount))} USDG${r.settled_amount !== r.amount ? ` <span class="dim">(permitted ${formatUsdg(BigInt(r.amount))})</span>` : ""}</td></tr>
<tr><th>Gas</th><td>${Number(r.gas_used).toLocaleString()} @ ${(Number(r.gas_price) / 1e9).toFixed(3)} gwei = ${eth(BigInt(r.gas_used) * BigInt(r.gas_price))}</td></tr>
<tr><th>Status</th><td class="${r.status ? "ok" : "bad"}">${r.status ? "success" : "failed"}</td></tr>
</tbody></table></div><p><a href="/">Back to overview</a></p>`;
  return shell(`Settlement ${short(r.tx_hash)}`, body, p.cfg);
}

export function renderAddress(p: {
  cfg: ScanConfig; explorer: string; address: string; page: number; limit: number; labels: Labels;
  asFacilitator: { items: Settlement[]; total: number }; asPayee: { items: Settlement[]; total: number }; asPayer: { items: Settlement[]; total: number };
}): string {
  const label = p.labels[p.address]?.label;
  const section = (title: string, data: { items: Settlement[]; total: number }, key: string) =>
    data.total === 0
      ? ""
      : `<h2>${title} <span class="dim">(${data.total.toLocaleString()})</span></h2>${settlementsTable(data.items, p.labels)}${
          data.total > p.limit ? `<p class="dim">Page ${p.page} of ${Math.ceil(data.total / p.limit)} · <a href="/address/${p.address}?page=${p.page + 1}#${key}">next</a></p>` : ""
        }`;
  const total = p.asFacilitator.total + p.asPayee.total + p.asPayer.total;
  const body = `<h2>Address</h2><p><span class="addr">${p.address}</span>${label ? ` · <b>${esc(label)}</b>` : ""} · <a href="${p.explorer}/address/${p.address}">Blockscout</a></p>
${total === 0 ? `<p class="dim">No indexed x402 settlements involve this address.</p>` : ""}
${section("As facilitator", p.asFacilitator, "fac")}${section("As payee", p.asPayee, "payee")}${section("As payer", p.asPayer, "payer")}<p><a href="/">Back to overview</a></p>`;
  return shell(`${label ?? short(p.address)} · Loxley Scan`, body, p.cfg);
}
