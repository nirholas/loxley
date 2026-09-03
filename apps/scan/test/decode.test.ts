import { describe, expect, it } from "vitest";
import { decodeSettleCalldata, transferInReceipt, SETTLED_TOPIC } from "../src/decode.js";
import { keccak256, toHex } from "viem";

import fixture from "./fixtures/settle-exact.json" with { type: "json" };

// Real calldata from Robinhood Chain tx 0x2bc1f32b553d820c3b7929ba50ccee2ffe23da826d1caf8a7590aa3a6ee66577 (block 53627470).
const REAL_INPUT = fixture.input;

describe("decodeSettleCalldata", () => {
  it("decodes an exact-scheme settle on the canonical proxy", () => {
    const d = decodeSettleCalldata("0x402085c248EeA27D92E8b30b2C58ed07f9E20001", REAL_INPUT as `0x${string}`);
    expect(d).not.toBeNull();
    expect(d!.scheme).toBe("exact");
    expect(d!.withPermit).toBe(false);
    expect(d!.token).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(d!.amount).toBe(10000n);
    expect(d!.settlementAmount).toBe(10000n);
    expect(d!.payer).toBe("0x14034747C60ed9349F72d1C39D570a1aF79577ca");
    expect(d!.payTo).toBe("0xbB818E97E2260904B1D502E154488392ba2Ab5C9");
  });
  it("ignores calls to other contracts", () => {
    expect(decodeSettleCalldata("0x0000000000000000000000000000000000000001", REAL_INPUT as `0x${string}`)).toBeNull();
  });
  it("has the right Settled() topic", () => {
    expect(keccak256(toHex("Settled()"))).toBe(SETTLED_TOPIC);
  });
});

describe("transferInReceipt", () => {
  it("finds the payer -> payee transfer of the settled token", () => {
    const pad = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}` as `0x${string}`;
    const logs = [
      {
        address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
        topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", pad("0x14034747C60ed9349F72d1C39D570a1aF79577ca"), pad("0xbB818E97E2260904B1D502E154488392ba2Ab5C9")],
        data: "0x0000000000000000000000000000000000000000000000000000000000002710",
      },
    ] as never;
    expect(transferInReceipt(logs, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "0x14034747C60ed9349F72d1C39D570a1aF79577ca", "0xbB818E97E2260904B1D502E154488392ba2Ab5C9")).toBe(10000n);
    expect(transferInReceipt(logs, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "0x14034747C60ed9349F72d1C39D570a1aF79577ca", "0x0000000000000000000000000000000000000001")).toBeNull();
  });
});
