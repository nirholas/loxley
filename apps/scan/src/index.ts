import "dotenv/config";
import { serve } from "@hono/node-server";
import { loadScanConfig } from "./config.js";
import { ScanDb } from "./db.js";
import { Indexer } from "./indexer.js";
import { createScanServer, VERSION } from "./server.js";

const cfg = loadScanConfig();
const db = new ScanDb(cfg.dbPath);
const indexer = new Indexer(cfg, db);

// Facilitator signers and payees the community already knows by name. Additions welcome via PR.
db.setLabel("0x43A047aE20bd92eD3a37610062b48Dc314fD17Ff", "Canopy relayer", "facilitator");

if (process.argv.includes("--once")) {
  const n = await indexer.catchUp();
  console.log(`[scan] indexed ${n} new settlements; cursor ${db.getCursor(cfg.network)}`);
  db.close();
  process.exit(0);
}

const app = createScanServer(cfg, db, indexer);
serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`Loxley Scan v${VERSION} on http://localhost:${info.port} indexing ${cfg.network} from block ${db.getCursor(cfg.network) ?? cfg.startBlock}`);
});
void indexer.run();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    indexer.stop();
    db.close();
    process.exit(0);
  });
}
