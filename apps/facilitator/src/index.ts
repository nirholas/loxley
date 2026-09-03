import "dotenv/config";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { FacilitatorDb } from "./db.js";
import { buildFacilitator } from "./facilitator.js";
import { createServer, VERSION } from "./server.js";
import { buildSigner, type NetworkSigner } from "./signer.js";

const cfg = loadConfig();
const db = new FacilitatorDb(cfg.dbPath);
const signers = new Map<string, NetworkSigner>(
  cfg.networks.map((network) => [network, buildSigner(cfg.privateKey, network, cfg.rpcUrls[network])]),
);
const facilitator = buildFacilitator(cfg, db, signers);
const app = createServer({ cfg, db, facilitator, signers });

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`Loxley facilitator v${VERSION} listening on http://localhost:${info.port}`);
  for (const [network, s] of signers) console.log(`  ${network} signer ${s.address} via ${cfg.rpcUrls[s.network]}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
