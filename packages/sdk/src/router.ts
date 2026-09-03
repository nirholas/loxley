import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";

export type SupportedResponse = {
  kinds: Array<{ x402Version: number; scheme: string; network: string; extra?: Record<string, unknown> }>;
  extensions: string[];
  signers: Record<string, string[]>;
};

/** Structural twin of @x402/core's FacilitatorClient, so the router plugs into x402ResourceServer directly. */
export interface FacilitatorClient {
  verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse>;
  getSupported(): Promise<SupportedResponse>;
}

type ResolvedEndpoint = { url: string; name: string; priority: number; headers?: Record<string, string> };

export type FacilitatorEndpoint = {
  /** Base URL, e.g. https://facilitator.loxley.dev */
  url: string;
  /** Display name for logs and stats. Defaults to the URL host. */
  name?: string;
  /** Extra headers (API keys). */
  headers?: Record<string, string>;
  /** Lower is preferred when scores tie. Default 0. */
  priority?: number;
};

export type RouterOptions = {
  /** Per-request timeout in ms. Default 15000 for verify, 60000 for settle. */
  verifyTimeoutMs?: number;
  settleTimeoutMs?: number;
  /** How long a facilitator stays benched after consecutive failures. Default 30000. */
  cooldownMs?: number;
  /** Consecutive failures before benching. Default 2. */
  failureThreshold?: number;
  /** Only route to facilitators that advertise this network in /supported. */
  requireNetwork?: string;
  /** Called on every routed request; hook it into your logger or metrics. */
  onEvent?: (event: RouterEvent) => void;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};

export type RouterEvent =
  | { type: "attempt"; op: "verify" | "settle" | "supported"; facilitator: string }
  | { type: "success"; op: "verify" | "settle" | "supported"; facilitator: string; latencyMs: number }
  | { type: "failure"; op: "verify" | "settle" | "supported"; facilitator: string; latencyMs: number; error: string }
  | { type: "benched"; facilitator: string; untilMs: number };

type Health = {
  consecutiveFailures: number;
  benchedUntil: number;
  ewmaLatencyMs: number;
  successes: number;
  failures: number;
  supported?: SupportedResponse;
  supportedAt?: number;
};

export class RouterError extends Error {
  constructor(message: string, readonly attempts: Array<{ facilitator: string; error: string }>) {
    super(message);
    this.name = "RouterError";
  }
}

/**
 * A FacilitatorClient that spreads a resource server across several facilitators.
 *
 * Verify is retried across facilitators freely: it is a read. Settle is retried only on transport
 * failures that provably happened before the facilitator acted (connection refused, DNS, 5xx before
 * broadcast), never after an ambiguous timeout, because a settle that timed out may still have landed
 * on-chain and the payer must not be charged twice. Facilitators that fail consecutively are benched
 * for a cooldown, and among the healthy ones the lowest EWMA latency wins.
 */
export class FacilitatorRouter implements FacilitatorClient {
  private readonly health = new Map<string, Health>();
  private readonly endpoints: ResolvedEndpoint[];
  private readonly opts: Required<Omit<RouterOptions, "requireNetwork" | "onEvent">> & Pick<RouterOptions, "requireNetwork" | "onEvent">;

  constructor(endpoints: FacilitatorEndpoint[], options: RouterOptions = {}) {
    if (endpoints.length === 0) throw new Error("FacilitatorRouter needs at least one facilitator");
    this.endpoints = endpoints.map((e) => ({
      url: e.url.replace(/\/+$/, ""),
      name: e.name ?? new URL(e.url).host,
      priority: e.priority ?? 0,
      headers: e.headers,
    }));
    this.opts = {
      verifyTimeoutMs: options.verifyTimeoutMs ?? 15_000,
      settleTimeoutMs: options.settleTimeoutMs ?? 60_000,
      cooldownMs: options.cooldownMs ?? 30_000,
      failureThreshold: options.failureThreshold ?? 2,
      fetch: options.fetch ?? globalThis.fetch,
      now: options.now ?? Date.now,
      requireNetwork: options.requireNetwork,
      onEvent: options.onEvent,
    };
    for (const e of this.endpoints) {
      this.health.set(e.name, { consecutiveFailures: 0, benchedUntil: 0, ewmaLatencyMs: 0, successes: 0, failures: 0 });
    }
  }

  /** Healthy facilitators, best first. */
  candidates(network?: string): ResolvedEndpoint[] {
    const now = this.opts.now();
    const net = network ?? this.opts.requireNetwork;
    return [...this.endpoints]
      .filter((e) => {
        const h = this.health.get(e.name)!;
        if (h.benchedUntil > now) return false;
        if (net && h.supported && !h.supported.kinds.some((k) => k.network === net)) return false;
        return true;
      })
      .sort((a, b) => {
        const ha = this.health.get(a.name)!;
        const hb = this.health.get(b.name)!;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return ha.ewmaLatencyMs - hb.ewmaLatencyMs;
      });
  }

  snapshot(): Record<string, Omit<Health, "supported">> {
    const out: Record<string, Omit<Health, "supported">> = {};
    for (const [name, { supported: _s, ...rest }] of this.health) out[name] = rest;
    return out;
  }

  async verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.route("verify", paymentRequirements.network, this.opts.verifyTimeoutMs, true, async (e, signal) => {
      const res = await this.post(e, "/verify", { paymentPayload, paymentRequirements }, signal);
      return (await res.json()) as VerifyResponse;
    });
  }

  async settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse> {
    return this.route("settle", paymentRequirements.network, this.opts.settleTimeoutMs, false, async (e, signal) => {
      const res = await this.post(e, "/settle", { paymentPayload, paymentRequirements }, signal);
      return (await res.json()) as SettleResponse;
    });
  }

  async getSupported(): Promise<SupportedResponse> {
    const merged: SupportedResponse = { kinds: [], extensions: [], signers: {} };
    const seen = new Set<string>();
    const attempts: Array<{ facilitator: string; error: string }> = [];
    for (const e of this.endpoints) {
      try {
        const s = await this.fetchSupported(e);
        for (const k of s.kinds) {
          const key = `${k.x402Version}:${k.scheme}:${k.network}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.kinds.push(k);
          }
        }
        for (const x of s.extensions) if (!merged.extensions.includes(x)) merged.extensions.push(x);
        for (const [ns, addrs] of Object.entries(s.signers)) {
          merged.signers[ns] = [...new Set([...(merged.signers[ns] ?? []), ...(addrs as string[])])];
        }
      } catch (error) {
        attempts.push({ facilitator: e.name, error: String(error) });
      }
    }
    if (merged.kinds.length === 0) throw new RouterError("no facilitator answered /supported", attempts);
    return merged;
  }

  /** Warm the /supported cache so network filtering is exact from the first request. */
  async refreshSupported(): Promise<void> {
    await Promise.allSettled(this.endpoints.map((e) => this.fetchSupported(e)));
  }

  private async fetchSupported(e: ResolvedEndpoint): Promise<SupportedResponse> {
    const h = this.health.get(e.name)!;
    const started = this.opts.now();
    this.opts.onEvent?.({ type: "attempt", op: "supported", facilitator: e.name });
    try {
      const res = await this.opts.fetch(`${e.url}/supported`, {
        headers: { accept: "application/json", ...e.headers },
        signal: AbortSignal.timeout(this.opts.verifyTimeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const supported = (await res.json()) as SupportedResponse;
      h.supported = supported;
      h.supportedAt = this.opts.now();
      this.record(e.name, true, this.opts.now() - started, "supported");
      return supported;
    } catch (error) {
      this.record(e.name, false, this.opts.now() - started, "supported", String(error));
      throw error;
    }
  }

  private async post(e: ResolvedEndpoint, path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const res = await this.opts.fetch(`${e.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...e.headers },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status >= 500) throw new TransportError(`HTTP ${res.status} from ${e.name}`);
    if (!res.ok) {
      // 4xx is a definitive answer from a healthy facilitator: surface it, do not fail over.
      const text = await res.text().catch(() => "");
      throw new DefinitiveError(`HTTP ${res.status} from ${e.name}: ${text.slice(0, 200)}`);
    }
    return res;
  }

  private async route<T>(
    op: "verify" | "settle",
    network: string,
    timeoutMs: number,
    retryOnTimeout: boolean,
    run: (e: ResolvedEndpoint, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const attempts: Array<{ facilitator: string; error: string }> = [];
    let candidates = this.candidates(network);
    if (candidates.length === 0) {
      // Everyone is benched: try them all anyway rather than failing a paying customer on a stale bench.
      candidates = [...this.endpoints];
    }
    for (const e of candidates) {
      const started = this.opts.now();
      this.opts.onEvent?.({ type: "attempt", op, facilitator: e.name });
      try {
        const result = await run(e, AbortSignal.timeout(timeoutMs));
        this.record(e.name, true, this.opts.now() - started, op);
        return result;
      } catch (error) {
        const latency = this.opts.now() - started;
        const msg = error instanceof Error ? error.message : String(error);
        if (error instanceof DefinitiveError) {
          this.record(e.name, true, latency, op);
          throw error;
        }
        this.record(e.name, false, latency, op, msg);
        attempts.push({ facilitator: e.name, error: msg });
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        if (timedOut && !retryOnTimeout) {
          throw new RouterError(`${op} timed out at ${e.name}; not retrying because the payment may have settled`, attempts);
        }
      }
    }
    throw new RouterError(`${op} failed at every facilitator`, attempts);
  }

  private record(name: string, ok: boolean, latencyMs: number, op: "verify" | "settle" | "supported", error?: string): void {
    const h = this.health.get(name)!;
    if (ok) {
      h.consecutiveFailures = 0;
      h.successes += 1;
      h.ewmaLatencyMs = h.ewmaLatencyMs === 0 ? latencyMs : h.ewmaLatencyMs * 0.7 + latencyMs * 0.3;
      this.opts.onEvent?.({ type: "success", op, facilitator: name, latencyMs });
      return;
    }
    h.consecutiveFailures += 1;
    h.failures += 1;
    this.opts.onEvent?.({ type: "failure", op, facilitator: name, latencyMs, error: error ?? "" });
    if (h.consecutiveFailures >= this.opts.failureThreshold) {
      h.benchedUntil = this.opts.now() + this.opts.cooldownMs;
      this.opts.onEvent?.({ type: "benched", facilitator: name, untilMs: h.benchedUntil });
    }
  }
}

class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

class DefinitiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefinitiveError";
  }
}

/** The facilitators known to serve Robinhood Chain, in the order Loxley recommends. */
export const KNOWN_FACILITATORS: FacilitatorEndpoint[] = [
  { url: "https://facilitator.loxley.dev", name: "loxley", priority: 0 },
  { url: "https://facilitator.canopyfinance.io", name: "canopy", priority: 1 },
];
