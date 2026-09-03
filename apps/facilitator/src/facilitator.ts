import { createHash } from "node:crypto";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { UptoEvmScheme } from "@x402/evm/upto/facilitator";
import { EIP2612_GAS_SPONSORING, createErc20ApprovalGasSponsoringExtension } from "@x402/extensions";
import { extractDiscoveryInfo } from "@x402/extensions/bazaar";
import type { Config } from "./config.js";
import type { FacilitatorDb } from "./db.js";
import type { NetworkSigner } from "./signer.js";

/** Stable hash of a payment payload: same signature, same hash, so a retried settle never double-spends gas. */
export function payloadHash(payload: PaymentPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** JSON with object keys sorted at every depth, so equal payloads hash equal regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Best-effort payer address from any EVM payload shape (EIP-3009 or Permit2). */
export function payerOf(payload: PaymentPayload): string | null {
  const p = payload.payload as Record<string, unknown> | undefined;
  const auth = (p?.authorization ?? p?.permit2Authorization) as Record<string, unknown> | undefined;
  return typeof auth?.from === "string" ? auth.from : null;
}

export type Timings = { verifyMs: number; settleMs: number };

export function buildFacilitator(cfg: Config, db: FacilitatorDb, signers: Map<string, NetworkSigner>): x402Facilitator {
  const facilitator = new x402Facilitator();
  const timers = new WeakMap<object, number>();

  for (const [network, signer] of signers) {
    facilitator.register(network as Network, new ExactEvmScheme(signer.evm, { eip6492AllowedFactories: cfg.eip6492Factories }));
    facilitator.register(network as Network, new UptoEvmScheme(signer.evm));
  }

  const first = signers.values().next().value as NetworkSigner;
  facilitator
    .registerExtension(EIP2612_GAS_SPONSORING)
    .registerExtension(
      createErc20ApprovalGasSponsoringExtension(first.erc20Approval, (network) => signers.get(network)?.erc20Approval),
    );

  facilitator
    .onBeforeVerify(async (ctx) => {
      timers.set(ctx.paymentPayload, performance.now());
    })
    .onAfterVerify(async (ctx) => {
      db.recordVerification({
        payload_hash: payloadHash(ctx.paymentPayload),
        network: ctx.requirements.network,
        scheme: ctx.requirements.scheme,
        payer: ctx.result.payer ?? payerOf(ctx.paymentPayload),
        is_valid: 1,
        invalid_reason: null,
        latency_ms: Math.round(performance.now() - (timers.get(ctx.paymentPayload) ?? performance.now())),
      });
      catalog(db, ctx.paymentPayload, ctx.requirements);
    })
    .onVerifyFailure(async (ctx) => {
      db.recordVerification({
        payload_hash: payloadHash(ctx.paymentPayload),
        network: ctx.requirements.network,
        scheme: ctx.requirements.scheme,
        payer: payerOf(ctx.paymentPayload),
        is_valid: 0,
        invalid_reason: ctx.error.message.slice(0, 200),
        latency_ms: Math.round(performance.now() - (timers.get(ctx.paymentPayload) ?? performance.now())),
      });
    })
    .onBeforeSettle(async (ctx) => {
      timers.set(ctx.paymentPayload, performance.now());
      const existing = db.getSettlement(payloadHash(ctx.paymentPayload));
      if (existing?.success) return { abort: true, reason: `already_settled:${existing.tx_hash}` };
    })
    .onAfterSettle(async (ctx) => {
      db.recordSettlement({
        payload_hash: payloadHash(ctx.paymentPayload),
        network: ctx.requirements.network,
        scheme: ctx.requirements.scheme,
        payer: ctx.result.payer ?? payerOf(ctx.paymentPayload),
        pay_to: ctx.requirements.payTo,
        asset: ctx.requirements.asset,
        amount: ctx.requirements.amount,
        resource: ctx.paymentPayload.resource?.url ?? null,
        tx_hash: ctx.result.transaction ?? null,
        success: ctx.result.success ? 1 : 0,
        error_reason: ctx.result.success ? null : (ctx.result.errorReason ?? null),
        latency_ms: Math.round(performance.now() - (timers.get(ctx.paymentPayload) ?? performance.now())),
      });
    })
    .onSettleFailure(async (ctx) => {
      db.recordSettlement({
        payload_hash: payloadHash(ctx.paymentPayload),
        network: ctx.requirements.network,
        scheme: ctx.requirements.scheme,
        payer: payerOf(ctx.paymentPayload),
        pay_to: ctx.requirements.payTo,
        asset: ctx.requirements.asset,
        amount: ctx.requirements.amount,
        resource: ctx.paymentPayload.resource?.url ?? null,
        tx_hash: null,
        success: 0,
        error_reason: ctx.error.message.slice(0, 200),
        latency_ms: Math.round(performance.now() - (timers.get(ctx.paymentPayload) ?? performance.now())),
      });
    });

  return facilitator;
}

/** Sellers that declare the Bazaar discovery extension get catalogued on their first verified payment. */
function catalog(db: FacilitatorDb, payload: PaymentPayload, requirements: PaymentRequirements): void {
  try {
    const discovered = extractDiscoveryInfo(payload, requirements, true);
    if (!discovered) return;
    db.upsertResource({
      resource: discovered.resourceUrl,
      type: discovered.discoveryInfo.input.type,
      x402Version: discovered.x402Version,
      accepts: [requirements],
      lastUpdated: new Date().toISOString(),
      description: discovered.description,
      mimeType: discovered.mimeType,
      serviceName: discovered.serviceName,
      tags: discovered.tags,
      iconUrl: discovered.iconUrl,
      extensions: discovered.extensions,
    });
  } catch {
    // A malformed discovery declaration must never fail a valid payment.
  }
}
