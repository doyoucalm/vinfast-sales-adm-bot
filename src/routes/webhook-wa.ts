import { Hono } from "hono";
import { EvolutionWebhookBody, EvolutionMessageData, InboundMessage } from "../types/evolution.js";
import { logger } from "../services/logger.js";
import { authenticate } from "../middleware/auth-wa.js";
import { route } from "../handlers/router.js";

const app = new Hono();

function parseInbound(body: EvolutionWebhookBody): InboundMessage | null {
  if (body.event !== "messages.upsert") return null;

  const data = body.data as EvolutionMessageData;
  if (!data?.key?.remoteJid) return null;

  if (data.key.remoteJid === "status@broadcast") return null;

  const isGroup = data.key.remoteJid.endsWith("@g.us");
  const fromJidRaw = isGroup
    ? (data.key.participant ?? data.key.remoteJid)
    : data.key.remoteJid;
  const fromNumber = fromJidRaw.replace(/@.*$/, "").replace(/[^\d]/g, "");

  let text = "";
  let type: InboundMessage["type"] = "other";
  let mediaCaption: string | undefined;

  const msg = data.message ?? {};
  if (msg.conversation) {
    text = msg.conversation;
    type = "text";
  } else if (msg.extendedTextMessage?.text) {
    text = msg.extendedTextMessage.text;
    type = "text";
  } else if (msg.imageMessage) {
    type = "image";
    mediaCaption = msg.imageMessage.caption;
    text = mediaCaption ?? "";
  } else if (msg.documentMessage) {
    type = "document";
    mediaCaption = msg.documentMessage.caption;
    text = mediaCaption ?? "";
  } else if (msg.audioMessage) {
    type = "audio";
  } else if (msg.videoMessage) {
    type = "video";
    mediaCaption = msg.videoMessage.caption;
    text = mediaCaption ?? "";
  }

  return {
    instance: body.instance,
    messageId: data.key.id,
    fromJid: fromJidRaw,
    fromNumber,
    fromMe: data.key.fromMe ?? false,
    isGroup,
    groupJid: isGroup ? data.key.remoteJid : undefined,
    pushName: data.pushName,
    text,
    type,
    mediaCaption,
    timestamp: new Date((data.messageTimestamp ?? Date.now() / 1000) * 1000),
    raw: data,
  };
}

app.post("/wa", async (c) => {
  let body: EvolutionWebhookBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  logger.debug({ event: body.event, instance: body.instance }, "WA webhook event");

  if (body.event !== "messages.upsert") {
    return c.json({ received: true, ignored: body.event });
  }

  const inbound = parseInbound(body);
  if (!inbound) {
    return c.json({ received: true, parsed: false });
  }

  setImmediate(async () => {
    try {
      const ctx = await authenticate(inbound);
      await route(ctx);
    } catch (err) {
      logger.error({ err: (err as Error).message, stack: (err as Error).stack }, "Async handler crashed");
    }
  });

  return c.json({ received: true });
});

export default app;
