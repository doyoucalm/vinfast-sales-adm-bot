import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { receiveMedia } from "../services/media-receiver.js";

export async function handleMediaTest(ctx: AuthContext): Promise<boolean> {
  if (!ctx.karyawan) return false;
  if (ctx.msg.type !== "image" && ctx.msg.type !== "document") return false;

  await evolution.sendText(ctx.msg.fromNumber, "📥 Menerima file...", { delayMs: 200 });

  const saved = await receiveMedia(ctx.msg, {
    category: "MISC",
    subfolder: ctx.msg.fromNumber,
    label: ctx.msg.type.toUpperCase(),
  });

  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal terima file. Coba kirim ulang.", { delayMs: 400 });
    return true;
  }

  const sizeKb = (saved.sizeBytes / 1024).toFixed(1);
  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ File diterima\n📁 ${saved.filename}\n📦 ${sizeKb} KB\n🔒 ${saved.sha256.slice(0, 12)}...\n\n_Preview: ${saved.previewUrl}_`,
    { delayMs: 400 }
  );

  return true;
}
