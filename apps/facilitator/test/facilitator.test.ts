import { describe, expect, it } from "vitest";
import type { PaymentPayload } from "@x402/core/types";
import { loadConfig } from "../src/config.js";
import { FacilitatorDb } from "../src/db.js";
import { payerOf, payloadHash } from "../src/facilitator.js";

const KEY = "0x" + "11".repeat(32);

describe("loadConfig", () => {
  it("parses defaults and validates networks", () => {
    const cfg = loadConfig({ FACILITATOR_PRIVATE_KEY: KEY });
    expect(cfg.networks).toEqual(["eip155:4663", "eip155:46630"]);
    expect(cfg.port).toBe(4663);
    expect(cfg.gasGrantWei).toBe(50_000_000_000_000n);
    expect(() => loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, FACILITATOR_NETWORKS: "eip155:8453" })).toThrow(/unsupported/);
    expect(() => loadConfig({ FACILITATOR_PRIVATE_KEY: "nope" })).toThrow();
  });
});

const payload = (nonce: string): PaymentPayload =>
  ({
    x402Version: 2,
    resource: { url: "https://api.example/quote", description: "q", mimeType: "application/json" },
    accepted: {
      scheme: "exact",
      network: "eip155:4663",
      amount: "10000",
      asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      payTo: "0xbB818E97E2260904B1D502E154488392ba2Ab5C9",
      maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: "permit2" },
    },
    payload: {
      signature: "0xsig",
      permit2Authorization: {
        from: "0x14034747C60ed9349F72d1C39D570a1aF79577ca",
        permitted: { token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", amount: "10000" },
        spender: "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
        nonce,
        deadline: "1788460692",
        witness: { to: "0xbB818E97E2260904B1D502E154488392ba2Ab5C9", validAfter: "0" },
      },
    },
  }) as unknown as PaymentPayload;

describe("payloadHash", () => {
  it("is stable across key order and distinct across nonces", () => {
    const a = payload("1");
    const reverse = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverse) : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reverse(x)]))
        : v;
    const reordered = reverse(a) as PaymentPayload;
    expect(payloadHash(a)).toBe(payloadHash(reordered));
    expect(payloadHash(a)).not.toBe(payloadHash(payload("2")));
  });
  it("extracts the payer from permit2 payloads", () => {
    expect(payerOf(payload("1"))).toBe("0x14034747C60ed9349F72d1C39D570a1aF79577ca");
  });
});

describe("FacilitatorDb", () => {
  it("journals settlements idempotently and aggregates stats", () => {
    const db = new FacilitatorDb(":memory:");
    const hash = payloadHash(payload("7"));
    db.recordSettlement({
      payload_hash: hash, network: "eip155:4663", scheme: "exact", payer: "0xpayer", pay_to: "0xto",
      asset: "0xusdg", amount: "10000", resource: "https://api.example/quote", tx_hash: "0xtx", success: 1, error_reason: null, latency_ms: 12,
    });
    db.recordSettlement({
      payload_hash: hash, network: "eip155:4663", scheme: "exact", payer: "0xpayer", pay_to: "0xto",
      asset: "0xusdg", amount: "10000", resource: "https://api.example/quote", tx_hash: "0xtx", success: 1, error_reason: null, latency_ms: 3,
    });
    expect(db.getSettlement(hash)?.tx_hash).toBe("0xtx");
    const s = db.stats();
    expect(s.settlements).toBe(1);
    expect(s.volumeByAsset).toEqual([{ network: "eip155:4663", asset: "0xusdg", amount: "10000", count: 1 }]);
  });

  it("catalogues resources and searches them", () => {
    const db = new FacilitatorDb(":memory:");
    db.upsertResource({
      resource: "https://api.example/quote", type: "http", x402Version: 2, accepts: [], lastUpdated: new Date().toISOString(),
      description: "Stock token reference quotes", serviceName: "Example Quotes", tags: ["rwa", "quotes"],
    });
    expect(db.listResources({ q: "stock", limit: 10, offset: 0 }).total).toBe(1);
    expect(db.listResources({ q: "weather", limit: 10, offset: 0 }).total).toBe(0);
    expect(db.listResources({ type: "mcp", limit: 10, offset: 0 }).total).toBe(0);
  });

  it("records one gas grant per address per network", () => {
    const db = new FacilitatorDb(":memory:");
    db.recordGasGrant({ address: "0xABCDEF0000000000000000000000000000000001", network: "eip155:4663", tx_hash: "0x1", amount_wei: "5" });
    expect(db.getGasGrant("0xabcdef0000000000000000000000000000000001", "eip155:4663")?.tx_hash).toBe("0x1");
    expect(db.getGasGrant("0xabcdef0000000000000000000000000000000001", "eip155:46630")).toBeUndefined();
    expect(() =>
      db.recordGasGrant({ address: "0xabcdef0000000000000000000000000000000001", network: "eip155:4663", tx_hash: "0x2", amount_wei: "5" }),
    ).toThrow();
  });
});
