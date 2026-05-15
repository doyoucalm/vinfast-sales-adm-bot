import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import { env } from "../config/env.js";

export const mediaPreviewRouter = new Hono();

mediaPreviewRouter.use(
  "/*",
  basicAuth({
    username: env.MEDIA_PREVIEW_USER,
    password: env.MEDIA_PREVIEW_PASS,
  })
);

mediaPreviewRouter.use(
  "/*",
  serveStatic({
    root: path.relative(process.cwd(), env.UPLOADS_DIR),
    rewriteRequestPath: (p) => p.replace(/^\/media/, ""),
  })
);
