import { describe, expect, it } from "vitest";
import { ScanDb, type Settlement } from "../src/db.js";

const row = (i: number, over: Partial<Settlement> = {}): Settlement => ({
  tx_hash: `0x${i.toString(16).padStart(64, "0")}`,
  log_index: 0,
  block_number: 1000 + i,
  block_time: 1_800_000_000 + i * 60,
  network: "eip155:4663",
  scheme: "exact",
  proxy: "0xproxy",
  facilitator: "0xfac",
  payer: `0xpayer${i % 3}`,
  pay_to: `0xpayee${i % 2}`,
  token: "0xusdg",
  amount: "10000",
  settled_amount: "10000",
  with_permit: 0,
  gas_used: "100000",
  gas_price: "300000000",
  status: 1,
  ...over,
});

describe("ScanDb", () => {
  it("inserts idempotently, tracks the cursor, and aggregates", () => {
    const db = new ScanDb(":memory:");
    expect(db.insertMany([row(1), row(2), row(3)])).toBe(3);
    expect(db.insertMany([row(1)])).toBe(0);
    db.setCursor("eip155:4663", 1003);
    expect(db.getCursor("eip155:4663")).toBe(1003);
    const o = db.overview(1_800_000_000 + 10 * 60);
    expect(o.all.count).toBe(3);
    expect(o.all.volume).toBe(30000);
    expect(o.all.payees).toBe(2);
    expect(db.leaderboard("pay_to")[0].count).toBe(2);
    expect(db.recent(2, 0).items.map((r) => r.block_number)).toEqual([1003, 1002]);
    expect(db.recent(10, 0, { payer: "0xPAYER1" }).total).toBe(1);
    expect(db.byHash(row(2).tx_hash)).toHaveLength(1);
  });
});
