import { createPublicClient, http, keccak256, toHex, type Hex, type Log, type PublicClient } from "viem";
import { X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY, chainForNetwork } from "@loxley/chain";
import type { ScanConfig } from "./config.js";
import { decodeSettleCalldata, transferInReceipt } from "./decode.js";
import type { ScanDb, Settlement } from "./db.js";

const SETTLED = keccak256(toHex("Settled()"));
const SETTLED_WITH_PERMIT = keccak256(toHex("SettledWithPermit()"));

export type IndexerStatus = { network: string; head: number; cursor: number; lag: number; indexing: boolean; lastError?: string; lastRunAt?: string };

export class Indexer {
  readonly client: PublicClient;
  private running = false;
  private stopped = false;
  private lastError?: string;
  private lastRunAt?: string;
  private head = 0;

  constructor(private readonly cfg: ScanConfig, private readonly db: ScanDb, client?: PublicClient) {
    this.client =
      client ??
      (createPublicClient({
        chain: chainForNetwork(cfg.network),
        transport: http(cfg.rpcUrl, { batch: true, retryCount: 4, retryDelay: 800 }),
      }) as PublicClient);
  }

  status(): IndexerStatus {
    const cursor = this.db.getCursor(this.cfg.network) ?? this.cfg.startBlock;
    return { network: this.cfg.network, head: this.head, cursor, lag: Math.max(this.head - cursor, 0), indexing: this.running, lastError: this.lastError, lastRunAt: this.lastRunAt };
  }

  /** Index from the cursor to (head - confirmations). Returns rows inserted. */
  async catchUp(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let inserted = 0;
    try {
      this.head = Number(await this.client.getBlockNumber());
      const target = this.head - this.cfg.confirmations;
      let from = (this.db.getCursor(this.cfg.network) ?? this.cfg.startBlock - 1) + 1;
      while (from <= target && !this.stopped) {
        const to = Math.min(from + this.cfg.window - 1, target);
        const logs = await this.getLogsWithBackoff(from, to);
        if (logs.length) inserted += await this.ingest(logs);
        this.db.setCursor(this.cfg.network, to);
        from = to + 1;
      }
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
    }
    return inserted;
  }

  /** Follow the head forever. */
  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const n = await this.catchUp();
        if (n) console.log(`[scan] +${n} settlements, cursor ${this.db.getCursor(this.cfg.network)}`);
      } catch (error) {
        console.error(`[scan] ${error instanceof Error ? error.message : error}`);
      }
      await new Promise((r) => setTimeout(r, this.cfg.pollMs));
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async getLogsWithBackoff(fromBlock: number, toBlock: number): Promise<Log[]> {
    let delay = 1_000;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.getLogs({
          address: [X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY],
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock),
        });
      } catch (error) {
        if (attempt >= 6) throw error;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 20_000);
      }
    }
  }

  private async ingest(logs: Log[]): Promise<number> {
    const byTx = new Map<Hex, Log[]>();
    for (const l of logs) {
      if (l.topics[0] !== SETTLED && l.topics[0] !== SETTLED_WITH_PERMIT) continue;
      if (!l.transactionHash) continue;
      byTx.set(l.transactionHash, [...(byTx.get(l.transactionHash) ?? []), l]);
    }
    const rows: Settlement[] = [];
    const blockTimes = new Map<bigint, number>();
    const hashes = [...byTx.keys()];
    const concurrency = 6;
    for (let i = 0; i < hashes.length; i += concurrency) {
      const chunk = hashes.slice(i, i + concurrency);
      const results = await Promise.all(
        chunk.map(async (hash) => {
          const [tx, receipt] = await Promise.all([this.client.getTransaction({ hash }), this.client.getTransactionReceipt({ hash })]);
          if (!blockTimes.has(receipt.blockNumber)) {
            const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
            blockTimes.set(receipt.blockNumber, Number(block.timestamp));
          }
          return { hash, tx, receipt, time: blockTimes.get(receipt.blockNumber)! };
        }),
      );
      for (const { hash, tx, receipt, time } of results) {
        if (!tx.to) continue;
        const decoded = decodeSettleCalldata(tx.to, tx.input);
        if (!decoded) continue;
        const moved = transferInReceipt(receipt.logs, decoded.token, decoded.payer, decoded.payTo);
        for (const l of byTx.get(hash)!) {
          rows.push({
            tx_hash: hash.toLowerCase(),
            log_index: Number(l.logIndex ?? 0),
            block_number: Number(receipt.blockNumber),
            block_time: time,
            network: this.cfg.network,
            scheme: decoded.scheme,
            proxy: tx.to.toLowerCase(),
            facilitator: tx.from.toLowerCase(),
            payer: decoded.payer.toLowerCase(),
            pay_to: decoded.payTo.toLowerCase(),
            token: decoded.token.toLowerCase(),
            amount: decoded.amount.toString(),
            settled_amount: (moved ?? decoded.settlementAmount).toString(),
            with_permit: l.topics[0] === SETTLED_WITH_PERMIT ? 1 : 0,
            gas_used: receipt.gasUsed.toString(),
            gas_price: (receipt.effectiveGasPrice ?? 0n).toString(),
            status: receipt.status === "success" ? 1 : 0,
          });
        }
      }
    }
    return this.db.insertMany(rows);
  }
}
