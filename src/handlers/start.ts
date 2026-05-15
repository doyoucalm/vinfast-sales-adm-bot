import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { turnOn } from "../services/session-mode.js";
import { redis } from "../services/redis.js";
import { logger } from "../services/logger.js";

export function isStartCommand(text: string): boolean {
  return /^\/start\b/i.test(text.trim());
}

export async function handleStart(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;

  const noWa = ctx.msg.fromNumber;
  await turnOn(noWa);

  try {
    const keys = await redis.keys(`conv:${noWa}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug({ noWa, cleared: keys.length }, "Conversation state cleared");
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Clear conv state failed (non-fatal)");
  }

  await evolution.sendText(
    noWa,
    `✅ Bot aktif kembali.\n\nHalo ${ctx.namaPanggilan} 👋\nKetik /help untuk daftar perintah.`,
    { delayMs: 400 }
  );
}
