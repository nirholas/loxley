import { describe, expect, it } from "vitest";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { FacilitatorRouter, RouterError } from "../src/router.js";

const payload = { x402Version: 2 } as unknown as PaymentPayload;
const reqs = { network: "eip155:4663", scheme: "exact" } as unknown as PaymentRequirements;

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function fakeFetch(handlers: Record<string, Handler>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const host = new URL(url).host;
    const h = handlers[host];
    if (!h) throw new TypeError(`fetch failed: ${host}`);
    return h(url, init);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("FacilitatorRouter", () => {
  it("fails over verify when the preferred facilitator is down", async () => {
    let clock = 0;
    const events: string[] = [];
    const router = new FacilitatorRouter(
      [
        { url: "https://a.test", priority: 0 },
        { url: "https://b.test", priority: 1 },
      ],
      {
        fetch: fakeFetch({ "b.test": () => json({ isValid: true, payer: "0xp" }) }),
        now: () => (clock += 10),
        onEvent: (e) => events.push(`${e.type}:${e.facilitator}`),
      },
    );
    const res = await router.verify(payload, reqs);
    expect(res.isValid).toBe(true);
    expect(events).toEqual(["attempt:a.test", "failure:a.test", "attempt:b.test", "success:b.test"]);
  });

  it("benches a facilitator after consecutive failures and prefers the healthy one", async () => {
    let clock = 0;
    const router = new FacilitatorRouter(
      [
        { url: "https://a.test", priority: 0 },
        { url: "https://b.test", priority: 0 },
      ],
      { fetch: fakeFetch({ "b.test": () => json({ isValid: true }) }), now: () => (clock += 10), failureThreshold: 2, cooldownMs: 1000 },
    );
    await router.verify(payload, reqs);
    await router.verify(payload, reqs);
    expect(router.snapshot()["a.test"].benchedUntil).toBeGreaterThan(0);
    expect(router.candidates().map((c) => c.name)).toEqual(["b.test"]);
    clock += 2000;
    expect(router.candidates().map((c) => c.name)).toContain("a.test");
  });

  it("does not retry a settle that timed out, because the payment may have landed", async () => {
    const router = new FacilitatorRouter(
      [
        { url: "https://a.test", priority: 0 },
        { url: "https://b.test", priority: 1 },
      ],
      {
        fetch: fakeFetch({
          "a.test": () => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
          "b.test": () => json({ success: true, transaction: "0xtx", network: "eip155:4663" }),
        }),
        settleTimeoutMs: 50,
      },
    );
    await expect(router.settle(payload, reqs)).rejects.toBeInstanceOf(RouterError);
  });

  it("retries a settle across facilitators on a pre-broadcast transport failure", async () => {
    const router = new FacilitatorRouter(
      [
        { url: "https://a.test", priority: 0 },
        { url: "https://b.test", priority: 1 },
      ],
      {
        fetch: fakeFetch({
          "a.test": () => json({ error: "boom" }, 503),
          "b.test": () => json({ success: true, transaction: "0xtx", network: "eip155:4663" }),
        }),
      },
    );
    const res = await router.settle(payload, reqs);
    expect(res.transaction).toBe("0xtx");
  });

  it("treats a 4xx as a definitive answer and does not fail over", async () => {
    let bCalls = 0;
    const router = new FacilitatorRouter(
      [
        { url: "https://a.test", priority: 0 },
        { url: "https://b.test", priority: 1 },
      ],
      {
        fetch: fakeFetch({
          "a.test": () => json({ error: "bad payload" }, 400),
          "b.test": () => {
            bCalls += 1;
            return json({ isValid: true });
          },
        }),
      },
    );
    await expect(router.verify(payload, reqs)).rejects.toThrow(/HTTP 400/);
    expect(bCalls).toBe(0);
  });

  it("merges /supported across facilitators and filters candidates by network", async () => {
    const router = new FacilitatorRouter(
      [
        { url: "https://a.test", priority: 0 },
        { url: "https://b.test", priority: 1 },
      ],
      {
        fetch: fakeFetch({
          "a.test": () => json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: ["bazaar"], signers: { eip155: ["0xa"] } }),
          "b.test": () => json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:4663" }], extensions: [], signers: { eip155: ["0xb"] } }),
        }),
      },
    );
    const s = await router.getSupported();
    expect(s.kinds.map((k) => k.network).sort()).toEqual(["eip155:4663", "eip155:8453"]);
    expect(s.signers.eip155).toEqual(["0xa", "0xb"]);
    expect(router.candidates("eip155:4663").map((c) => c.name)).toEqual(["b.test"]);
  });
});
