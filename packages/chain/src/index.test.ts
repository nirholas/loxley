import { describe, expect, it } from "vitest";
import { formatUsdg, parseUsdg, registerRobinhoodMoneyParser, robinhoodChain, USDG_ADDRESS } from "./index.js";

describe("parseUsdg", () => {
  it("parses dollar strings to 6-decimal atomic units", () => {
    expect(parseUsdg("$0.01")).toBe(10000n);
    expect(parseUsdg("1")).toBe(1_000_000n);
    expect(parseUsdg("0.000001")).toBe(1n);
    expect(parseUsdg(0.25)).toBe(250_000n);
  });
  it("rejects sub-micro precision and garbage", () => {
    expect(() => parseUsdg("0.0000001")).toThrow();
    expect(() => parseUsdg("abc")).toThrow();
    expect(() => parseUsdg("-1")).toThrow();
  });
});

describe("formatUsdg", () => {
  it("round-trips", () => {
    expect(formatUsdg(10000n)).toBe("0.01");
    expect(formatUsdg(1_000_000n)).toBe("1");
    expect(formatUsdg(parseUsdg("12.5"))).toBe("12.5");
  });
});

describe("registerRobinhoodMoneyParser", () => {
  it("resolves USD amounts to USDG with the permit2 hint, and ignores other networks", async () => {
    let parser: ((amount: number, network: string) => Promise<unknown>) | undefined;
    registerRobinhoodMoneyParser({ registerMoneyParser: (p) => { parser = p as typeof parser; } });
    expect(await parser!(0.01, "eip155:4663")).toEqual({
      amount: "10000",
      asset: USDG_ADDRESS,
      extra: { assetTransferMethod: "permit2" },
    });
    expect(await parser!(0.01, "eip155:8453")).toBeUndefined();
  });
});

describe("chain definition", () => {
  it("is chain 4663 with multicall3", () => {
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.contracts?.multicall3?.address).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
  });
});
