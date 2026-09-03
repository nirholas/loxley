import { Hono } from "hono";
import { cors } from "hono/cors";
import { EXPLORER_URLS, formatUsdg, type RobinhoodNetwork } from "@loxley/chain";
import type { ScanConfig } from "./config.js";
import type { ScanDb, Settlement } from "./db.js";
import type { Indexer } from "./indexer.js";
import { renderPage, renderAddress, renderTx } from "./ui.js";

export const VERSION = "0.1.0";

export function createScanServer(cfg: ScanConfig, db: ScanDb, indexer: Indexer): Hono {
  const app = new Hono();
  app.use("/api/*", cors({ origin: "*" }));
  const explorer = EXPLORER_URLS[cfg.network as RobinhoodNetwork];

  app.get("/api", (c) =>
    c.json({
      name: "Loxley Scan",
      version: VERSION,
      network: cfg.network,
      endpoints: ["/api/overview", "/api/settlements", "/api/settlements/:txHash", "/api/facilitators", "/api/payees", "/api/payers", "/api/daily", "/api/status"],
    }),
  );
  app.get("/api/status", (c) => c.json({ ...indexer.status(), version: VERSION }));
  app.get("/api/overview", (c) => c.json(db.overview()));
  app.get("/api/daily", (c) => c.json(db.daily(Math.min(Number(c.req.query("days") ?? 30), 365))));
  app.get("/api/settlements", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 500);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
    return c.json(db.recent(limit, offset, { facilitator: c.req.query("facilitator"), payTo: c.req.query("payTo"), payer: c.req.query("payer") }));
  });
  app.get("/api/settlements/:txHash", (c) => {
    const rows = db.byHash(c.req.param("txHash"));
    return rows.length ? c.json(rows) : c.json({ error: "not indexed" }, 404);
  });
  const since = (c: { req: { query: (k: string) => string | undefined } }) => {
    const d = Number(c.req.query("days") ?? 0);
    return d > 0 ? Math.floor(Date.now() / 1000) - d * 86_400 : 0;
  };
  app.get("/api/facilitators", (c) => c.json(db.leaderboard("facilitator", 50, since(c))));
  app.get("/api/payees", (c) => c.json(db.leaderboard("pay_to", 50, since(c))));
  app.get("/api/payers", (c) => c.json(db.leaderboard("payer", 50, since(c))));
  app.get("/api/labels", (c) => c.json(db.labels()));

  app.get("/", (c) => {
    const overview = db.overview();
    const recent = db.recent(25, 0).items;
    return c.html(
      renderPage({
        cfg,
        explorer,
        status: indexer.status(),
        overview,
        daily: db.daily(30),
        facilitators: db.leaderboard("facilitator", 10),
        payees: db.leaderboard("pay_to", 10),
        payers: db.leaderboard("payer", 10),
        recent,
        labels: db.labels(),
      }),
    );
  });
  app.get("/tx/:hash", (c) => {
    const rows = db.byHash(c.req.param("hash"));
    if (!rows.length) return c.html(renderTx({ cfg, explorer, rows: [], labels: db.labels() }), 404);
    return c.html(renderTx({ cfg, explorer, rows, labels: db.labels() }));
  });
  app.get("/address/:address", (c) => {
    const address = c.req.param("address").toLowerCase();
    const page = Math.max(Number(c.req.query("page") ?? 1), 1);
    const limit = 50;
    const asFacilitator = db.recent(limit, (page - 1) * limit, { facilitator: address });
    const asPayee = db.recent(limit, (page - 1) * limit, { payTo: address });
    const asPayer = db.recent(limit, (page - 1) * limit, { payer: address });
    return c.html(renderAddress({ cfg, explorer, address, asFacilitator, asPayee, asPayer, page, limit, labels: db.labels() }));
  });

  return app;
}

export type { Settlement };
export { formatUsdg };
