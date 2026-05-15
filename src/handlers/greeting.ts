import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { logger } from "../services/logger.js";

const GREETING_PATTERNS = [
  /^halo\b/i,
  /^hai\b/i,
  /^hi\b/i,
  /^hey\b/i,
  /^assalamu/i,
  /^pagi\b/i,
  /^siang\b/i,
  /^sore\b/i,
  /^malam\b/i,
  /^p\s*$/i,
  /^test\b/i,
  /^ping\b/i,
];

export function isGreeting(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return GREETING_PATTERNS.some((re) => re.test(t));
}

export async function handleGreeting(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) {
    logger.info({ from: ctx.msg.fromNumber }, "Greeting from non-karyawan, ignored");
    return;
  }

  const nama = ctx.namaPanggilan ?? "";
  const reply = `Halo ${nama} 👋, ada yang bisa dibantu?\n\nKetik /help untuk daftar perintah.`;
  await evolution.sendText(ctx.msg.fromNumber, reply, { delayMs: 800 });
}
