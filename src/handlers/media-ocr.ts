import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { receiveMedia } from "../services/media-receiver.js";
import { parseKtp, parseBuktiTf } from "../services/ocr.js";
import { getConvState, setConvState, clearConvState } from "../services/conv-state.js";
import { appendRow } from "../services/sheets.js";
import { logger } from "../services/logger.js";

type Category = "KTP" | "SETORAN" | "MISC";

function detectCategory(caption: string): "ktp" | "tf" | null {
  if (/ktp/i.test(caption)) return "ktp";
  if (/\btf\b|\btrf\b|transfer/i.test(caption)) return "tf";
  return null;
}

export async function handleIncomingMedia(ctx: AuthContext): Promise<boolean> {
  if (!ctx.karyawan) return false;

  const caption = ctx.msg.mediaCaption ?? ctx.msg.text ?? "";
  const detected = detectCategory(caption);

  const category: Category = detected === "ktp" ? "KTP" : detected === "tf" ? "SETORAN" : "MISC";
  const label = detected === "ktp" ? "KTP" : detected === "tf" ? "TF" : "FOTO";

  const saved = await receiveMedia(ctx.msg, {
    category,
    subfolder: ctx.msg.fromNumber,
    label,
  });

  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal menerima foto. Coba kirim ulang.", { delayMs: 300 });
    return true;
  }

  if (detected === "ktp") {
    await runKtp(ctx, saved.absPath, saved.mimeType, saved.relPath);
  } else if (detected === "tf") {
    await runTf(ctx, saved.absPath, saved.mimeType, saved.relPath);
  } else {
    // Simpan path di conv state, tanya user
    await setConvState(ctx.msg.fromNumber, {
      flow: "media_pending",
      step: "WAITING_TYPE",
      data: { absPath: saved.absPath, mimeType: saved.mimeType, relPath: saved.relPath },
    });
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Foto diterima. Ini untuk apa?\n\n*ktp* — Scan KTP\n*tf* — Bukti transfer\n\n_Balas salah satu, atau abaikan jika bukan dokumen penting._`,
      { delayMs: 400 }
    );
  }

  return true;
}

// Handles text reply "ktp" / "tf" when there's a pending media waiting for classification
export async function handlePendingMediaChoice(ctx: AuthContext): Promise<boolean> {
  const state = await getConvState(ctx.msg.fromNumber);
  if (!state || state.flow !== "media_pending" || state.step !== "WAITING_TYPE") return false;

  const t = ctx.msg.text.trim().toLowerCase();
  const isKtp = /^ktp$/i.test(t);
  const isTf = /^(tf|trf|transfer)$/i.test(t);
  if (!isKtp && !isTf) return false;

  await clearConvState(ctx.msg.fromNumber);

  const { absPath, mimeType, relPath } = state.data as {
    absPath: string;
    mimeType: string;
    relPath: string;
  };

  if (isKtp) {
    await runKtp(ctx, absPath, mimeType, relPath);
  } else {
    await runTf(ctx, absPath, mimeType, relPath);
  }

  return true;
}

const PRIVILEGED_ROLES = new Set(["owner", "admin", "manager"]);

async function runKtp(ctx: AuthContext, absPath: string, mimeType: string, relPath: string): Promise<void> {
  await evolution.sendText(ctx.msg.fromNumber, "🔍 Memproses KTP...", { delayMs: 300 });

  try {
    const ktp = await parseKtp(absPath, mimeType);
    const pct = Math.round(ktp.confidence * 100);

    if (ktp.confidence < 0.3) {
      await evolution.sendText(
        ctx.msg.fromNumber,
        `⚠️ KTP tidak terbaca (${pct}%). Coba foto ulang dengan pencahayaan lebih baik.`,
        { delayMs: 400 }
      );
      return;
    }

    const warn = ktp.confidence < 0.7 ? " ⚠️ _foto kurang jelas_" : "";
    const canSeeDetail = PRIVILEGED_ROLES.has(ctx.karyawan?.role ?? "");

    if (canSeeDetail) {
      const lines = [
        `✅ *KTP diterima (${pct}%)${warn}*`,
        ``,
        `NIK        : \`${ktp.nik ?? "-"}\``,
        `Nama       : ${ktp.nama ?? "-"}`,
        `TTL        : ${ktp.tempat_lahir ?? "-"}, ${ktp.tgl_lahir ?? "-"}`,
        `JK         : ${ktp.jenis_kelamin ?? "-"}`,
        `Alamat     : ${ktp.alamat ?? "-"}`,
        `RT/RW      : ${ktp.rt_rw ?? "-"}`,
        `Kel/Desa   : ${ktp.kelurahan ?? "-"}`,
        `Kecamatan  : ${ktp.kecamatan ?? "-"}`,
        `Kab/Kota   : ${ktp.kabupaten ?? "-"}`,
        `Provinsi   : ${ktp.provinsi ?? "-"}`,
        `Agama      : ${ktp.agama ?? "-"}`,
        `Status     : ${ktp.status_kawin ?? "-"}`,
        `Pekerjaan  : ${ktp.pekerjaan ?? "-"}`,
        `Berlaku    : ${ktp.berlaku_hingga ?? "-"}`,
      ];
      await evolution.sendText(ctx.msg.fromNumber, lines.join("\n"), { delayMs: 500 });
    } else {
      await evolution.sendText(ctx.msg.fromNumber, `✅ KTP diterima (${pct}%)${warn}`, { delayMs: 400 });
    }

    pushKtpSheet(ctx, ktp, relPath).catch((e) =>
      logger.error({ err: e.message }, "ktp.sheet.failed")
    );

    logger.info({ noWa: ctx.msg.fromNumber, nik: ktp.nik, confidence: ktp.confidence }, "ocr.ktp.ok");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "ocr.ktp.error");
    await evolution.sendText(ctx.msg.fromNumber, "❌ OCR gagal. Coba kirim ulang.", { delayMs: 400 });
  }
}

async function runTf(ctx: AuthContext, absPath: string, mimeType: string, relPath: string): Promise<void> {
  await evolution.sendText(ctx.msg.fromNumber, "🔍 Memproses bukti transfer...", { delayMs: 300 });

  try {
    const tf = await parseBuktiTf(absPath, mimeType);
    const pct = Math.round(tf.confidence * 100);

    if (tf.confidence < 0.3) {
      await evolution.sendText(
        ctx.msg.fromNumber,
        `⚠️ Bukti transfer tidak terbaca (${pct}%). Coba foto ulang.`,
        { delayMs: 400 }
      );
      return;
    }

    const warn = tf.confidence < 0.7 ? " ⚠️ _foto kurang jelas_" : "";
    const nominal = tf.nominal ? `Rp${tf.nominal.toLocaleString("id-ID")}` : "-";
    await evolution.sendText(
      ctx.msg.fromNumber,
      `✅ Transfer diterima (${pct}%)${warn}\n${tf.bank ?? ""} · ${nominal}`,
      { delayMs: 400 }
    );

    pushTfSheet(ctx, tf, relPath).catch((e) =>
      logger.error({ err: e.message }, "tf.sheet.failed")
    );

    logger.info({ noWa: ctx.msg.fromNumber, nominal: tf.nominal, confidence: tf.confidence }, "ocr.tf.ok");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "ocr.tf.error");
    await evolution.sendText(ctx.msg.fromNumber, "❌ OCR gagal. Coba kirim ulang.", { delayMs: 400 });
  }
}

async function pushKtpSheet(
  ctx: AuthContext,
  ktp: Awaited<ReturnType<typeof parseKtp>>,
  relPath: string
): Promise<void> {
  await appendRow("KTP_Parsed", [
    new Date().toISOString(),
    ctx.karyawan?.noWa ?? ctx.msg.fromNumber,
    ktp.nik, ktp.nama, ktp.tempat_lahir, ktp.tgl_lahir, ktp.jenis_kelamin,
    ktp.alamat, ktp.rt_rw, ktp.kelurahan, ktp.kecamatan, ktp.kabupaten, ktp.provinsi,
    ktp.agama, ktp.status_kawin, ktp.pekerjaan, ktp.kewarganegaraan, ktp.berlaku_hingga,
    Math.round((ktp.confidence ?? 0) * 100) / 100,
    relPath,
    null, null, null, null, // context, linked_spk_temp, save_as_customer, customer_id
  ]);
}

async function pushTfSheet(
  ctx: AuthContext,
  tf: Awaited<ReturnType<typeof parseBuktiTf>>,
  relPath: string
): Promise<void> {
  await appendRow("Setoran_Pending", [
    new Date().toISOString(),
    ctx.karyawan?.noWa ?? ctx.msg.fromNumber,
    ctx.karyawan?.nama ?? null,
    null, null, null, null, // linked_to, linked_id, customer_nama, customer_hp
    "BOOKING",              // jenis_setoran default
    tf.nominal, null,       // nominal, nominal_words
    tf.bank, tf.nama_pengirim, tf.rekening_pengirim,
    null, tf.rekening_penerima, // bank_tujuan, no_rek_tujuan
    tf.tgl_transfer, tf.jam_transfer, tf.no_referensi,
    relPath,
    Math.round((tf.confidence ?? 0) * 100) / 100,
    "PENDING", null, null, null, // status_verif, verified_by, verified_at, notes_admin
    null, null,              // pushed_to_db, pushed_at
  ]);
}
