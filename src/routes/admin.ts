import { Hono } from "hono";
import { env } from "../config/env.js";
import { syncKaryawan } from "../jobs/sync-karyawan.js";
import { syncSpkLeads } from "../jobs/sync-spk.js";
import { migrateDriveFromLeadsSpk } from "../jobs/drive-migrate.js";
import { logger } from "../services/logger.js";

export const adminRouter = new Hono();

adminRouter.use("*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== env.EVOLUTION_WEBHOOK_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

adminRouter.post("/sync/karyawan", async (c) => {
  const force = c.req.query("force") === "1";
  try {
    const result = await syncKaryawan({ force });
    return c.json({ ok: true, result });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "admin.sync_karyawan.failed");
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

adminRouter.post("/sync/spk", async (c) => {
  try {
    const result = await syncSpkLeads();
    return c.json({ ok: true, result });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "admin.sync_spk.failed");
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

adminRouter.post("/migrate/drive", async (c) => {
  const limit  = c.req.query("limit")  ? Number(c.req.query("limit")) : undefined;
  const dryRun = c.req.query("dry")    === "1";
  try {
    const result = await migrateDriveFromLeadsSpk({ limit, dryRun });
    return c.json({ ok: true, result });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "admin.drive_migrate.failed");
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});
