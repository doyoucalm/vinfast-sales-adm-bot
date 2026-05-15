import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { turnOff } from "../services/session-mode.js";

export function isManualCommand(text: string): boolean {
  return /^\/manual\b/i.test(text.trim());
}

export async function handleManual(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;
  await turnOff(ctx.msg.fromNumber);
  await evolution.sendText(
    ctx.msg.fromNumber,
    "🔇 Bot dimatikan untuk sesi ini.\n\nKetik /start kalau butuh bot lagi.\n_Auto-reset dalam 24 jam._",
    { delayMs: 400 }
  );
}
