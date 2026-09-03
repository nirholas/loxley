import { Hono } from "hono";
import { cors } from "hono/cors";
import type { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY, assetForNetwork } from "@loxley/chain";
import type { Config } from "./config.js";
import type { FacilitatorDb } from "./db.js";
import { payloadHash } from "./facilitator.js";
import { grantGas } from "./gasGrant.js";
import type { NetworkSigner } from "./signer.js";

export const VERSION = "0.1.0";

export type ServerDeps = {
  cfg: Config;
  db: FacilitatorDb;
  facilitator: x402Facilitator;
  signers: Map<string, NetworkSigner>;
  startedAt?: number;
};

type Body = { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements };

export function createServer({ cfg, db, facilitator, signers, startedAt = Date.now() }: ServerDeps): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

  app.get("/", (c) =>
    c.json({
      name: "Loxley Facilitator",
      version: VERSION,
      description: "Open x402 facilitator for Robinhood Chain. USDG over Permit2, exact and upto schemes.",
      networks: [...signers.keys()],
      signers: Object.fromEntries([...signers].map(([n, s]) => [n, s.address])),
      contracts: { permit2: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY, uptoProxy: X402_UPTO_PERMIT2_PROXY },
      endpoints: ["/supported", "/verify", "/settle", "/discovery/resources", "/gas-grant", "/health", "/metrics", "/stats"],
      docs: "https://github.com/nirholas/loxley",
    }),
  );

  app.get("/supported", (c) => c.json(facilitator.getSupported()));

  app.post("/verify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Body | null;
    if (!body?.paymentPayload || !body.paymentRequirements) {
      return c.json({ error: "Missing paymentPayload or paymentRequirements" }, 400);
    }
    try {
      return c.json(await facilitator.verify(body.paymentPayload, body.paymentRequirements));
    } catch (error) {
      return c.json({ isValid: false, invalidReason: "facilitator_error", invalidMessage: message(error) }, 500);
    }
  });

  app.post("/settle", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Body | null;
    if (!body?.paymentPayload || !body.paymentRequirements) {
      return c.json({ error: "Missing paymentPayload or paymentRequirements" }, 400);
    }
    const { paymentPayload, paymentRequirements } = body;

    // Idempotent: a retried settle for an already-broadcast payment returns the original receipt.
    const prior = db.getSettlement(payloadHash(paymentPayload));
    if (prior?.success && prior.tx_hash) {
      const replay: SettleResponse = {
        success: true,
        transaction: prior.tx_hash,
        network: prior.network as SettleResponse["network"],
        payer: prior.payer ?? undefined,
      };
      c.header("X-Loxley-Idempotent-Replay", "true");
      return c.json(replay);
    }

    try {
      return c.json(await facilitator.settle(paymentPayload, paymentRequirements));
    } catch (error) {
      const msg = message(error);
      if (msg.startsWith("Settlement aborted: already_settled:")) {
        const tx = msg.slice("Settlement aborted: already_settled:".length);
        c.header("X-Loxley-Idempotent-Replay", "true");
        return c.json({ success: true, transaction: tx, network: paymentRequirements.network } satisfies SettleResponse);
      }
      const failed: SettleResponse = {
        success: false,
        errorReason: msg.replace(/^Settlement aborted: /, "").slice(0, 200),
        transaction: "",
        network: paymentRequirements.network,
      };
      return c.json(failed, msg.startsWith("Settlement aborted") ? 200 : 500);
    }
  });

  app.get("/discovery/resources", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
    const type = c.req.query("type") ?? undefined;
    const q = c.req.query("q") ?? undefined;
    const { items, total } = db.listResources({ type, q, limit, offset });
    return c.json({ x402Version: 2, items, pagination: { limit, offset, total } });
  });

  app.post("/gas-grant", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { address?: string; network?: string } | null;
    const network = body?.network ?? cfg.networks[0];
    const signer = signers.get(network);
    if (!signer) return c.json({ ok: false, reason: "unsupported_network" }, 400);
    if (!body?.address) return c.json({ ok: false, reason: "invalid_address" }, 400);
    const result = await grantGas(cfg, db, signer, body.address);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/health", async (c) => {
    const networks = await Promise.all(
      [...signers.values()].map(async (s) => {
        try {
          const [balance, block] = await Promise.all([s.client.getBalance({ address: s.address }), s.client.getBlockNumber()]);
          return {
            network: s.network,
            signer: s.address,
            balanceWei: balance.toString(),
            blockNumber: Number(block),
            asset: assetForNetwork(s.network).address,
            ok: balance > 0n,
          };
        } catch (error) {
          return { network: s.network, signer: s.address, ok: false, error: message(error) };
        }
      }),
    );
    const ok = networks.every((n) => n.ok);
    return c.json({ ok, version: VERSION, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), networks }, ok ? 200 : 503);
  });

  app.get("/stats", (c) => c.json(db.stats()));

  app.get("/metrics", (c) => {
    const s = db.stats();
    const lines = [
      "# HELP loxley_settlements_total Settlement attempts recorded by this facilitator.",
      "# TYPE loxley_settlements_total counter",
      `loxley_settlements_total{result="success"} ${s.settlementsOk}`,
      `loxley_settlements_total{result="failure"} ${s.settlements - s.settlementsOk}`,
      "# HELP loxley_verifications_total Verification attempts recorded by this facilitator.",
      "# TYPE loxley_verifications_total counter",
      `loxley_verifications_total{result="valid"} ${s.verificationsOk}`,
      `loxley_verifications_total{result="invalid"} ${s.verifications - s.verificationsOk}`,
      "# HELP loxley_resources_catalogued Distinct x402 resources discovered through Bazaar declarations.",
      "# TYPE loxley_resources_catalogued gauge",
      `loxley_resources_catalogued ${s.resources}`,
      "# HELP loxley_gas_grants_total Approval gas grants sent.",
      "# TYPE loxley_gas_grants_total counter",
      `loxley_gas_grants_total ${s.gasGrants}`,
      "# HELP loxley_settled_volume_atomic Settled volume in the asset's atomic units.",
      "# TYPE loxley_settled_volume_atomic counter",
      ...s.volumeByAsset.map((v) => `loxley_settled_volume_atomic{network="${v.network}",asset="${v.asset}"} ${v.amount}`),
    ];
    return c.text(lines.join("\n") + "\n", 200, { "content-type": "text/plain; version=0.0.4" });
  });

  return app;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
