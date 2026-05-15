import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { receiveMedia } from "../services/media-receiver.js";
import { parseKtp } from "../services/ocr.js";
import { setConvState, clearConvState } from "../services/conv-state.js";
import { appendRow } from "../services/sheets.js";
import { logger } from "../services/logger.js";

export function isKtpCommand(text: string): boolean {
  return /^\/ktp\b/i.test(text.trim());
}

// /ktp command: just prompt, photo handled by handleKtpAutoDetect
export async function handleKtpCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;
  await setConvState(ctx.msg.fromNumber, { flow: "ktp", step: "WAITING_PHOTO", data: {} });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `📸 Siap. Kirim foto KTP pembeli sekarang.`,
    { delayMs: 300 }
  );
}

// Auto-detect KTP from any incoming image.
// Returns true if handled (KTP or OCR attempted), false if image is clearly not a KTP.
export async function handleKtpAutoDetect(ctx: AuthContext): Promise<boolean> {
  if (!ctx.karyawan) return false;

  const saved = await receiveMedia(ctx.msg, {
    category: "KTP",
    subfolder: ctx.msg.fromNumber,
    label: "KTP",
  });

  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal menerima foto. Coba kirim ulang.", { delayMs: 400 });
    return true;
  }

  let ktp;
  try {
    ktp = await parseKtp(saved.absPath, saved.mimeType);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "ktp.ocr.error");
    // OCR failed → not treated as KTP, let caller fall through
    return false;
  }

  // Not a KTP → tell caller to handle as generic file
  if (ktp.confidence < 0.3) return false;

  const pct = Math.round(ktp.confidence * 100);
  const warn = ktp.confidence < 0.7 ? " ⚠️ _foto kurang jelas_" : "";

  await clearConvState(ctx.msg.fromNumber);
  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ KTP diterima (${pct}%)${warn}`,
    { delayMs: 400 }
  );

  // Push to Sheets (non-blocking, fire-and-forget)
  pushKtpToSheets(ctx, ktp, saved.relPath).catch((err) =>
    logger.error({ err: err.message }, "ktp.sheets.push.failed")
  );

  logger.info({ noWa: ctx.msg.fromNumber, nik: ktp.nik, confidence: ktp.confidence }, "ktp.auto.ok");
  return true;
}

async function pushKtpToSheets(
  ctx: AuthContext,
  ktp: Awaited<ReturnType<typeof parseKtp>>,
  relPath: string
): Promise<void> {
  const now = new Date().toISOString();
  const salesWa = ctx.karyawan?.noWa ?? ctx.msg.fromNumber;
  await appendRow("KTP_Parsed", [
    now,
    salesWa,
    ktp.nik,
    ktp.nama,
    ktp.tempat_lahir,
    ktp.tgl_lahir,
    ktp.jenis_kelamin,
    ktp.alamat,
    ktp.rt_rw,
    ktp.kelurahan,
    ktp.kecamatan,
    ktp.kabupaten,
    ktp.provinsi,
    ktp.agama,
    ktp.status_kawin,
    ktp.pekerjaan,
    ktp.kewarganegaraan,
    ktp.berlaku_hingga,
    Math.round((ktp.confidence ?? 0) * 100) / 100,
    relPath,
    null, // context
    null, // linked_spk_temp
    null, // save_as_customer
    null, // customer_id
  ]);
}
