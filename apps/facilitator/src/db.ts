import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DiscoveryResource } from "@x402/extensions/bazaar";

export type SettlementRow = {
  payload_hash: string;
  network: string;
  scheme: string;
  payer: string | null;
  pay_to: string | null;
  asset: string | null;
  amount: string | null;
  resource: string | null;
  tx_hash: string | null;
  success: number;
  error_reason: string | null;
  latency_ms: number;
  created_at: string;
};

export type VerificationRow = {
  payload_hash: string;
  network: string;
  scheme: string;
  payer: string | null;
  is_valid: number;
  invalid_reason: string | null;
  latency_ms: number;
  created_at: string;
};

export type GasGrantRow = { address: string; network: string; tx_hash: string; amount_wei: string; created_at: string };

export class FacilitatorDb {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settlements (
        payload_hash TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        scheme TEXT NOT NULL,
        payer TEXT, pay_to TEXT, asset TEXT, amount TEXT, resource TEXT,
        tx_hash TEXT, success INTEGER NOT NULL, error_reason TEXT,
        latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS settlements_created ON settlements(created_at);
      CREATE TABLE IF NOT EXISTS verifications (
        id INTEGER PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        network TEXT NOT NULL,
        scheme TEXT NOT NULL,
        payer TEXT,
        is_valid INTEGER NOT NULL,
        invalid_reason TEXT,
        latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS resources (
        resource TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        x402_version INTEGER NOT NULL,
        accepts_json TEXT NOT NULL,
        last_updated TEXT NOT NULL,
        description TEXT, mime_type TEXT, service_name TEXT, tags_json TEXT, icon_url TEXT, extensions_json TEXT,
        first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        settle_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS gas_grants (
        address TEXT NOT NULL,
        network TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        amount_wei TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (address, network)
      );
    `);
  }

  recordVerification(row: Omit<VerificationRow, "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO verifications (payload_hash, network, scheme, payer, is_valid, invalid_reason, latency_ms)
         VALUES (@payload_hash, @network, @scheme, @payer, @is_valid, @invalid_reason, @latency_ms)`,
      )
      .run(row);
  }

  getSettlement(payloadHash: string): SettlementRow | undefined {
    return this.db.prepare(`SELECT * FROM settlements WHERE payload_hash = ?`).get(payloadHash) as SettlementRow | undefined;
  }

  recordSettlement(row: Omit<SettlementRow, "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO settlements (payload_hash, network, scheme, payer, pay_to, asset, amount, resource, tx_hash, success, error_reason, latency_ms)
         VALUES (@payload_hash, @network, @scheme, @payer, @pay_to, @asset, @amount, @resource, @tx_hash, @success, @error_reason, @latency_ms)
         ON CONFLICT(payload_hash) DO UPDATE SET
           tx_hash = excluded.tx_hash, success = excluded.success, error_reason = excluded.error_reason, latency_ms = excluded.latency_ms`,
      )
      .run(row);
    if (row.success && row.resource) {
      this.db.prepare(`UPDATE resources SET settle_count = settle_count + 1 WHERE resource = ?`).run(row.resource);
    }
  }

  upsertResource(r: DiscoveryResource): void {
    this.db
      .prepare(
        `INSERT INTO resources (resource, type, x402_version, accepts_json, last_updated, description, mime_type, service_name, tags_json, icon_url, extensions_json)
         VALUES (@resource, @type, @x402_version, @accepts_json, @last_updated, @description, @mime_type, @service_name, @tags_json, @icon_url, @extensions_json)
         ON CONFLICT(resource) DO UPDATE SET
           type = excluded.type, x402_version = excluded.x402_version, accepts_json = excluded.accepts_json,
           last_updated = excluded.last_updated, description = excluded.description, mime_type = excluded.mime_type,
           service_name = excluded.service_name, tags_json = excluded.tags_json, icon_url = excluded.icon_url,
           extensions_json = excluded.extensions_json`,
      )
      .run({
        resource: r.resource,
        type: r.type,
        x402_version: r.x402Version,
        accepts_json: JSON.stringify(r.accepts),
        last_updated: r.lastUpdated,
        description: r.description ?? null,
        mime_type: r.mimeType ?? null,
        service_name: r.serviceName ?? null,
        tags_json: r.tags ? JSON.stringify(r.tags) : null,
        icon_url: r.iconUrl ?? null,
        extensions_json: r.extensions ? JSON.stringify(r.extensions) : null,
      });
  }

  listResources(opts: { type?: string; q?: string; limit: number; offset: number }): { items: DiscoveryResource[]; total: number } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.type) {
      where.push("type = @type");
      params.type = opts.type;
    }
    if (opts.q) {
      where.push("(resource LIKE @q OR description LIKE @q OR service_name LIKE @q OR tags_json LIKE @q)");
      params.q = `%${opts.q}%`;
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM resources ${clause}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM resources ${clause} ORDER BY settle_count DESC, last_updated DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: opts.limit, offset: opts.offset }) as Array<Record<string, unknown>>;
    return {
      total,
      items: rows.map((row) => ({
        resource: row.resource as string,
        type: row.type as string,
        x402Version: row.x402_version as number,
        accepts: JSON.parse(row.accepts_json as string),
        lastUpdated: row.last_updated as string,
        description: (row.description as string | null) ?? undefined,
        mimeType: (row.mime_type as string | null) ?? undefined,
        serviceName: (row.service_name as string | null) ?? undefined,
        tags: row.tags_json ? JSON.parse(row.tags_json as string) : undefined,
        iconUrl: (row.icon_url as string | null) ?? undefined,
        extensions: row.extensions_json ? JSON.parse(row.extensions_json as string) : undefined,
      })),
    };
  }

  getGasGrant(address: string, network: string): GasGrantRow | undefined {
    return this.db.prepare(`SELECT * FROM gas_grants WHERE address = ? AND network = ?`).get(address.toLowerCase(), network) as
      | GasGrantRow
      | undefined;
  }

  recordGasGrant(row: Omit<GasGrantRow, "created_at">): void {
    this.db
      .prepare(`INSERT INTO gas_grants (address, network, tx_hash, amount_wei) VALUES (@address, @network, @tx_hash, @amount_wei)`)
      .run({ ...row, address: row.address.toLowerCase() });
  }

  stats(): {
    settlements: number;
    settlementsOk: number;
    verifications: number;
    verificationsOk: number;
    resources: number;
    gasGrants: number;
    volumeByAsset: Array<{ network: string; asset: string; amount: string; count: number }>;
  } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    const volume = this.db
      .prepare(
        `SELECT network, asset, COUNT(*) AS count, CAST(SUM(CAST(amount AS INTEGER)) AS TEXT) AS amount
         FROM settlements WHERE success = 1 AND asset IS NOT NULL GROUP BY network, asset`,
      )
      .all() as Array<{ network: string; asset: string; amount: string; count: number }>;
    return {
      settlements: one("SELECT COUNT(*) AS n FROM settlements"),
      settlementsOk: one("SELECT COUNT(*) AS n FROM settlements WHERE success = 1"),
      verifications: one("SELECT COUNT(*) AS n FROM verifications"),
      verificationsOk: one("SELECT COUNT(*) AS n FROM verifications WHERE is_valid = 1"),
      resources: one("SELECT COUNT(*) AS n FROM resources"),
      gasGrants: one("SELECT COUNT(*) AS n FROM gas_grants"),
      volumeByAsset: volume,
    };
  }

  close(): void {
    this.db.close();
  }
}
