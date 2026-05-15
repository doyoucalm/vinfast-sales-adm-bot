import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { env } from "./config/env.js";
import { logger } from "./services/logger.js";
import { dbHealth, dbClose } from "./db/client.js";
import { redis, redisHealth } from "./services/redis.js";
import { evolution } from "./services/evolution.js";
import webhookWa from "./routes/webhook-wa.js";
import { mediaPreviewRouter } from "./routes/media-preview.js";

const app = new Hono();

app.use("*", honoLogger((msg) => logger.debug(msg)));

app.get("/", (c) => c.json({ service: "vinfast-bot", status: "ok", version: "0.1.0" }));

app.get("/health", async (c) => {
  const [db, rd, waState] = await Promise.all([
    dbHealth(),
    redisHealth(),
    evolution.connectionState().catch(() => "error"),
  ]);
  const ok = db && rd;
  return c.json(
    {
      status: ok ? "ok" : "degraded",
      checks: { db, redis: rd, wa: waState },
      uptime_sec: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    },
    ok ? 200 : 503
  );
});

app.route("/webhook", webhookWa);
app.route("/media", mediaPreviewRouter);

const server = serve(
  { fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" },
  (info) => logger.info({ port: info.port, env: env.NODE_ENV }, "vinfast-bot started")
);

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down...");
  server.close(async (err) => {
    if (err) logger.error({ err: err.message }, "Server close error");
    try {
      await redis.quit();
      await dbClose();
      logger.info("Shutdown clean");
      process.exit(0);
    } catch (e) {
      logger.error({ err: (e as Error).message }, "Shutdown error");
      process.exit(1);
    }
  });
  setTimeout(() => { logger.error("Force exit after 10s"); process.exit(1); }, 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, "Uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  process.exit(1);
});
