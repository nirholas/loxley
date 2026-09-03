import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Settlement = {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_time: number;
  network: string;
  scheme: "exact" | "upto";
  proxy: string;
  facilitator: string;
  payer: string;
  pay_to: string;
  token: string;
  amount: string;
  settled_amount: string;
  with_permit: number;
  gas_used: string;
  gas_price: string;
  status: number;
};

export type Cursor = { network: string; last_block: number; updated_at: string };

export class ScanDb {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settlements (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        block_time INTEGER NOT NULL,
        network TEXT NOT NULL,
        scheme TEXT NOT NULL,
        proxy TEXT NOT NULL,
        facilitator TEXT NOT NULL,
        payer TEXT NOT NULL,
        pay_to TEXT NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        settled_amount TEXT NOT NULL,
        with_permit INTEGER NOT NULL,
        gas_used TEXT NOT NULL,
        gas_price TEXT NOT NULL,
        status INTEGER NOT NULL,
        PRIMARY KEY (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS s_block ON settlements(block_number DESC);
      CREATE INDEX IF NOT EXISTS s_time ON settlements(block_time DESC);
      CREATE INDEX IF NOT EXISTS s_facilitator ON settlements(facilitator);
      CREATE INDEX IF NOT EXISTS s_pay_to ON settlements(pay_to);
      CREATE INDEX IF NOT EXISTS s_payer ON settlements(payer);
      CREATE TABLE IF NOT EXISTS cursors (
        network TEXT PRIMARY KEY,
        last_block INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS labels (
        address TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        kind TEXT NOT NULL
      );
    `);
  }

  getCursor(network: string): number | undefined {
    const row = this.db.prepare(`SELECT last_block FROM cursors WHERE network = ?`).get(network) as { last_block: number } | undefined;
    return row?.last_block;
  }

  setCursor(network: string, block: number): void {
    this.db
      .prepare(
        `INSERT INTO cursors (network, last_block) VALUES (?, ?)
         ON CONFLICT(network) DO UPDATE SET last_block = excluded.last_block, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(network, block);
  }

  insertMany(rows: Settlement[]): number {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO settlements (tx_hash, log_index, block_number, block_time, network, scheme, proxy, facilitator, payer, pay_to, token, amount, settled_amount, with_permit, gas_used, gas_price, status)
       VALUES (@tx_hash, @log_index, @block_number, @block_time, @network, @scheme, @proxy, @facilitator, @payer, @pay_to, @token, @amount, @settled_amount, @with_permit, @gas_used, @gas_price, @status)`,
    );
    const run = this.db.transaction((items: Settlement[]) => {
      let n = 0;
      for (const r of items) n += stmt.run(r).changes;
      return n;
    });
    return run(rows);
  }

  setLabel(address: string, label: string, kind: string): void {
    this.db
      .prepare(`INSERT INTO labels (address, label, kind) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET label = excluded.label, kind = excluded.kind`)
      .run(address.toLowerCase(), label, kind);
  }

  labels(): Record<string, { label: string; kind: string }> {
    const out: Record<string, { label: string; kind: string }> = {};
    for (const r of this.db.prepare(`SELECT * FROM labels`).all() as Array<{ address: string; label: string; kind: string }>) {
      out[r.address] = { label: r.label, kind: r.kind };
    }
    return out;
  }

  recent(limit: number, offset: number, filter: { facilitator?: string; payTo?: string; payer?: string } = {}) {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit, offset };
    if (filter.facilitator) { where.push("facilitator = @facilitator"); params.facilitator = filter.facilitator.toLowerCase(); }
    if (filter.payTo) { where.push("pay_to = @payTo"); params.payTo = filter.payTo.toLowerCase(); }
    if (filter.payer) { where.push("payer = @payer"); params.payer = filter.payer.toLowerCase(); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const items = this.db
      .prepare(`SELECT * FROM settlements ${clause} ORDER BY block_number DESC, log_index DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Settlement[];
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM settlements ${clause}`).get(params) as { n: number }).n;
    return { items, total };
  }

  byHash(txHash: string): Settlement[] {
    return this.db.prepare(`SELECT * FROM settlements WHERE tx_hash = ? ORDER BY log_index`).all(txHash.toLowerCase()) as Settlement[];
  }

  overview(now = Math.floor(Date.now() / 1000)) {
    const bucket = (since: number) =>
      this.db
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(CAST(settled_amount AS INTEGER)), 0) AS volume,
                  COUNT(DISTINCT payer) AS payers, COUNT(DISTINCT pay_to) AS payees, COUNT(DISTINCT facilitator) AS facilitators,
                  COALESCE(SUM(CAST(gas_used AS INTEGER) * CAST(gas_price AS INTEGER)), 0) AS gas_wei
           FROM settlements WHERE status = 1 AND block_time >= ?`,
        )
        .get(since) as { count: number; volume: number; payers: number; payees: number; facilitators: number; gas_wei: number };
    const failed = (this.db.prepare(`SELECT COUNT(*) AS n FROM settlements WHERE status = 0`).get() as { n: number }).n;
    const first = this.db.prepare(`SELECT MIN(block_time) AS t, MIN(block_number) AS b FROM settlements`).get() as { t: number | null; b: number | null };
    const latest = this.db.prepare(`SELECT MAX(block_time) AS t, MAX(block_number) AS b FROM settlements`).get() as { t: number | null; b: number | null };
    return {
      all: bucket(0),
      day: bucket(now - 86_400),
      week: bucket(now - 7 * 86_400),
      failed,
      firstSettlement: first,
      latestSettlement: latest,
    };
  }

  leaderboard(column: "facilitator" | "pay_to" | "payer", limit = 25, since = 0) {
    return this.db
      .prepare(
        `SELECT ${column} AS address, COUNT(*) AS count, CAST(SUM(CAST(settled_amount AS INTEGER)) AS TEXT) AS volume,
                MIN(block_time) AS first_seen, MAX(block_time) AS last_seen, COUNT(DISTINCT ${column === "payer" ? "pay_to" : "payer"}) AS counterparties
         FROM settlements WHERE status = 1 AND block_time >= ? GROUP BY ${column} ORDER BY count DESC LIMIT ?`,
      )
      .all(since, limit) as Array<{ address: string; count: number; volume: string; first_seen: number; last_seen: number; counterparties: number }>;
  }

  /** Daily buckets for the chart: UTC day -> settlements, volume. */
  daily(days = 30, now = Math.floor(Date.now() / 1000)) {
    const since = now - days * 86_400;
    return this.db
      .prepare(
        `SELECT (block_time / 86400) * 86400 AS day, COUNT(*) AS count, CAST(SUM(CAST(settled_amount AS INTEGER)) AS TEXT) AS volume,
                COUNT(DISTINCT payer) AS payers
         FROM settlements WHERE status = 1 AND block_time >= ? GROUP BY day ORDER BY day`,
      )
      .all(since) as Array<{ day: number; count: number; volume: string; payers: number }>;
  }

  close(): void {
    this.db.close();
  }
}
