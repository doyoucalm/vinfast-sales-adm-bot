import type { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { receiveMedia } from "../services/media-receiver.js";
import { parseKtp, parseBuktiTf, type KtpData, type BuktiTfData } from "../services/ocr.js";
import { parseSpkTemplate, type ParsedSpk } from "../services/spk-parser.js";
import { validateSpk } from "../services/spk-validator.js";
import { nextSpkTempNumber } from "../services/spk-counter.js";
import { getConvState, setConvState, clearConvState } from "../services/conv-state.js";
import { appendRow } from "../services/sheets.js";
import { logger } from "../services/logger.js";

const FLOW = "spk";

type Step = "WAITING_TEMPLATE" | "WAITING_STNK_CONFIRM" | "WAITING_KTP_PEMBELI" | "WAITING_KTP_STNK" | "WAITING_TF" | "CONFIRM";

interface SpkData {
  no_spk_temp: string;
  parsed: ParsedSpk;
  ktp_pembeli: KtpData | null;
  ktp_pembeli_path: string | null;
  ktp_pembeli_skipped: boolean;
  ktp_stnk: KtpData | null;
  ktp_stnk_path: string | null;
  ktp_stnk_skipped: boolean;
  tf: BuktiTfData | null;
  tf_path: string | null;
  tf_skipped: boolean;
  stnk_sama: boolean;
}

const TEMPLATE = `Salin & isi template berikut, lalu kirim:

SPK a.n :
STNK :
Type :
Warna :
Booking :
Baterai :
Pembayaran :
Sales :

_(STNK boleh diisi "sama" kalau atas nama pembeli)_
_(Ketik /batal untuk membatalkan)_`;

export function isSpkCommand(text: string): boolean {
  return /^\/spk\b/i.test(text.trim());
}

export function isBatalCommand(text: string): boolean {
  return /^\/batal\b/i.test(text.trim());
}

export async function handleSpkCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;
  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_TEMPLATE", data: {} });
  await evolution.sendText(ctx.msg.fromNumber, TEMPLATE, { delayMs: 400 });
}

export async function handleSpkBatal(ctx: AuthContext): Promise<boolean> {
  const state = await getConvState(ctx.msg.fromNumber);
  if (!state || state.flow !== FLOW) return false;
  await clearConvState(ctx.msg.fromNumber);
  await evolution.sendText(ctx.msg.fromNumber, "❌ Input SPK dibatalkan.", { delayMs: 300 });
  return true;
}

export async function handleSpkFlow(ctx: AuthContext): Promise<boolean> {
  const state = await getConvState(ctx.msg.fromNumber);
  if (!state || state.flow !== FLOW) return false;

  const step = state.step as Step;
  const data = ((state.data as Record<string, unknown>) ?? {}) as Partial<SpkData>;

  switch (step) {
    case "WAITING_TEMPLATE":      return stepTemplate(ctx, data);
    case "WAITING_STNK_CONFIRM":  return stepStnkConfirm(ctx, data);
    case "WAITING_KTP_PEMBELI":   return stepKtpPembeli(ctx, data);
    case "WAITING_KTP_STNK":      return stepKtpStnk(ctx, data);
    case "WAITING_TF":            return stepTf(ctx, data);
    case "CONFIRM":               return stepConfirm(ctx, data);
    default:
      await clearConvState(ctx.msg.fromNumber);
      return false;
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function stepTemplate(ctx: AuthContext, data: Partial<SpkData>): Promise<boolean> {
  void data;
  const text = ctx.msg.text?.trim() ?? "";
  if (!text || ctx.msg.type === "image" || ctx.msg.type === "document") {
    await evolution.sendText(ctx.msg.fromNumber, "Kirim template terisi (teks). Ketik /batal untuk batal.", { delayMs: 300 });
    return true;
  }

  await evolution.sendText(ctx.msg.fromNumber, "🔍 Parsing form...", { delayMs: 200 });
  const parsed = await parseSpkTemplate(text);

  if (parsed.missing.length > 0) {
    if (parsed.missing.length === 1 && parsed.missing[0] === "stnk" && parsed.spk_an) {
      await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_STNK_CONFIRM", data: { parsed } });
      await evolution.sendText(
        ctx.msg.fromNumber,
        `STNK atas nama *${parsed.spk_an}* (sama dengan pembeli)?\n\nBalas *sama* untuk lanjut, atau kirim ulang template dengan STNK diisi.`,
        { delayMs: 400 }
      );
      return true;
    }
    const list = parsed.missing.map((k) => `• ${labelOf(k)}`).join("\n");
    await evolution.sendText(
      ctx.msg.fromNumber,
      `⚠️ Field belum lengkap:\n${list}\n\nKirim ulang template lengkap.`,
      { delayMs: 400 }
    );
    return true;
  }

  const no_spk_temp = await nextSpkTempNumber();
  const stnk_sama =
    !!parsed.stnk && !!parsed.spk_an &&
    parsed.stnk.toLowerCase() === parsed.spk_an.toLowerCase();

  const newData: SpkData = {
    no_spk_temp, parsed,
    ktp_pembeli: null, ktp_pembeli_path: null, ktp_pembeli_skipped: false,
    ktp_stnk: null, ktp_stnk_path: null, ktp_stnk_skipped: false,
    tf: null, tf_path: null, tf_skipped: false,
    stnk_sama,
  };

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_KTP_PEMBELI", data: newData });

  await evolution.sendText(ctx.msg.fromNumber, [
    `✅ Form OK · *${no_spk_temp}*`,
    ``,
    `Pembeli  : ${parsed.spk_an}`,
    `STNK     : ${parsed.stnk}${stnk_sama ? " _(sama)_" : ""}`,
    `Type     : ${parsed.type} · ${parsed.warna}`,
    `Baterai  : ${parsed.baterai} · ${parsed.pembayaran}`,
    `Booking  : Rp ${parsed.booking?.toLocaleString("id-ID")}`,
    `Sales    : ${parsed.sales}`,
    ``,
    `📸 Kirim *foto KTP Pembeli*, atau ketik *skip* untuk lewati.`,
  ].join("\n"), { delayMs: 500 });
  return true;
}

async function stepStnkConfirm(ctx: AuthContext, data: Partial<SpkData>): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();

  if (!/^(sama|ya|yes|iya|ok|oke)$/i.test(text)) {
    if (text.includes(":")) return stepTemplate(ctx, {});
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Balas *sama* kalau STNK atas nama ${data.parsed?.spk_an ?? "pembeli"}, atau kirim ulang template dengan STNK diisi.`,
      { delayMs: 300 }
    );
    return true;
  }

  const parsed = { ...data.parsed!, stnk: data.parsed!.spk_an, missing: [] } as ParsedSpk;
  const no_spk_temp = await nextSpkTempNumber();

  const newData: SpkData = {
    no_spk_temp, parsed,
    ktp_pembeli: null, ktp_pembeli_path: null, ktp_pembeli_skipped: false,
    ktp_stnk: null, ktp_stnk_path: null, ktp_stnk_skipped: false,
    tf: null, tf_path: null, tf_skipped: false,
    stnk_sama: true,
  };

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_KTP_PEMBELI", data: newData });

  await evolution.sendText(ctx.msg.fromNumber, [
    `✅ Form OK · *${no_spk_temp}*`,
    ``,
    `Pembeli  : ${parsed.spk_an}`,
    `STNK     : ${parsed.stnk} _(sama)_`,
    `Type     : ${parsed.type} · ${parsed.warna}`,
    `Baterai  : ${parsed.baterai} · ${parsed.pembayaran}`,
    `Booking  : Rp ${parsed.booking?.toLocaleString("id-ID")}`,
    `Sales    : ${parsed.sales}`,
    ``,
    `📸 Kirim *foto KTP Pembeli*, atau ketik *skip* untuk lewati.`,
  ].join("\n"), { delayMs: 500 });
  return true;
}

async function stepKtpPembeli(ctx: AuthContext, data: Partial<SpkData>): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();

  if (ctx.msg.type !== "image" && ctx.msg.type !== "document" && /^(skip|lewati|nanti)$/i.test(text)) {
    data.ktp_pembeli = null;
    data.ktp_pembeli_path = null;
    data.ktp_pembeli_skipped = true;

    if (data.stnk_sama) {
      data.ktp_stnk = null;
      data.ktp_stnk_path = null;
      data.ktp_stnk_skipped = true;
      await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_TF", data: data as SpkData });
      await evolution.sendText(
        ctx.msg.fromNumber,
        `⏭️ KTP Pembeli & STNK di-skip.\n\n💰 Kirim *bukti transfer*, atau ketik *skip*.`,
        { delayMs: 400 }
      );
      return true;
    }

    await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_KTP_STNK", data: data as SpkData });
    await evolution.sendText(
      ctx.msg.fromNumber,
      `⏭️ KTP Pembeli di-skip.\n\n📸 Kirim *foto KTP STNK* (a.n ${data.parsed!.stnk}), atau ketik *skip*.`,
      { delayMs: 400 }
    );
    return true;
  }

  if (ctx.msg.type !== "image" && ctx.msg.type !== "document") {
    await evolution.sendText(
      ctx.msg.fromNumber,
      "📸 Kirim foto *KTP Pembeli*, ketik *skip* untuk lewati, atau */batal* untuk batalkan.",
      { delayMs: 300 }
    );
    return true;
  }

  await evolution.sendText(ctx.msg.fromNumber, "🔍 Membaca KTP Pembeli...", { delayMs: 200 });

  const saved = await receiveMedia(ctx.msg, { category: "SPK", subfolder: data.no_spk_temp!, label: "KTP_PEMBELI" });
  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal terima foto. Coba lagi atau ketik *skip*.", { delayMs: 300 });
    return true;
  }

  let ktp: KtpData;
  try {
    ktp = await parseKtp(saved.absPath, saved.mimeType);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "spk.ktp_pembeli.ocr.failed");
    await evolution.sendText(ctx.msg.fromNumber, "❌ OCR gagal. Kirim ulang atau ketik *skip*.", { delayMs: 300 });
    return true;
  }

  const pct = Math.round(ktp.confidence * 100);
  if (ktp.confidence < 0.3) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `⚠️ KTP tidak terbaca (${pct}%). Kirim ulang foto lebih jelas, atau ketik *skip*.`,
      { delayMs: 400 }
    );
    return true;
  }

  data.ktp_pembeli = ktp;
  data.ktp_pembeli_path = saved.relPath;
  data.ktp_pembeli_skipped = false;
  pushKtpParsed(ctx, ktp, saved.relPath, "SPK_KTP_PEMBELI", data.no_spk_temp!);

  if (data.stnk_sama) {
    data.ktp_stnk = ktp;
    data.ktp_stnk_path = saved.relPath;
    data.ktp_stnk_skipped = false;
    await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_TF", data: data as SpkData });
    await evolution.sendText(
      ctx.msg.fromNumber,
      `✅ KTP Pembeli OK (${pct}%) · STNK pakai KTP yang sama\n\n💰 Kirim *bukti transfer*, atau ketik *skip*.`,
      { delayMs: 500 }
    );
    return true;
  }

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_KTP_STNK", data: data as SpkData });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ KTP Pembeli OK (${pct}%)\n\n📸 Kirim *foto KTP STNK* (a.n ${data.parsed!.stnk}), atau ketik *skip*.`,
    { delayMs: 500 }
  );
  return true;
}

async function stepKtpStnk(ctx: AuthContext, data: Partial<SpkData>): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();

  if (ctx.msg.type !== "image" && ctx.msg.type !== "document" && /^(skip|lewati|nanti)$/i.test(text)) {
    data.ktp_stnk = null;
    data.ktp_stnk_path = null;
    data.ktp_stnk_skipped = true;
    await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_TF", data: data as SpkData });
    await evolution.sendText(
      ctx.msg.fromNumber,
      `⏭️ KTP STNK di-skip.\n\n💰 Kirim *bukti transfer*, atau ketik *skip*.`,
      { delayMs: 400 }
    );
    return true;
  }

  if (ctx.msg.type !== "image" && ctx.msg.type !== "document") {
    await evolution.sendText(
      ctx.msg.fromNumber,
      "📸 Kirim foto *KTP STNK*, ketik *skip* untuk lewati, atau */batal* untuk batalkan.",
      { delayMs: 300 }
    );
    return true;
  }

  await evolution.sendText(ctx.msg.fromNumber, "🔍 Membaca KTP STNK...", { delayMs: 200 });

  const saved = await receiveMedia(ctx.msg, { category: "SPK", subfolder: data.no_spk_temp!, label: "KTP_STNK" });
  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal terima foto. Atau ketik *skip*.", { delayMs: 300 });
    return true;
  }

  let ktp: KtpData;
  try {
    ktp = await parseKtp(saved.absPath, saved.mimeType);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "spk.ktp_stnk.ocr.failed");
    await evolution.sendText(ctx.msg.fromNumber, "❌ OCR gagal. Atau ketik *skip*.", { delayMs: 300 });
    return true;
  }

  const pct = Math.round(ktp.confidence * 100);
  if (ktp.confidence < 0.3) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `⚠️ KTP STNK tidak terbaca (${pct}%). Kirim ulang atau ketik *skip*.`,
      { delayMs: 400 }
    );
    return true;
  }

  data.ktp_stnk = ktp;
  data.ktp_stnk_path = saved.relPath;
  data.ktp_stnk_skipped = false;
  pushKtpParsed(ctx, ktp, saved.relPath, "SPK_KTP_STNK", data.no_spk_temp!);

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_TF", data: data as SpkData });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ KTP STNK OK (${pct}%)\n\n💰 Kirim *bukti transfer*, atau ketik *skip*.`,
    { delayMs: 500 }
  );
  return true;
}

async function stepTf(ctx: AuthContext, data: Partial<SpkData>): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();

  if (ctx.msg.type !== "image" && ctx.msg.type !== "document") {
    if (/^(skip|lewati|nanti)$/i.test(text)) {
      data.tf = null;
      data.tf_path = null;
      data.tf_skipped = true;
      await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "CONFIRM", data: data as SpkData });
      return renderConfirm(ctx, data as SpkData);
    }
    await evolution.sendText(
      ctx.msg.fromNumber,
      "💰 Kirim *foto bukti transfer*, ketik *skip* untuk lewati, atau */batal* untuk batalkan.",
      { delayMs: 300 }
    );
    return true;
  }

  await evolution.sendText(ctx.msg.fromNumber, "🔍 Membaca bukti transfer...", { delayMs: 200 });

  const saved = await receiveMedia(ctx.msg, { category: "SPK", subfolder: data.no_spk_temp!, label: "BUKTI_TF" });
  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal terima foto.", { delayMs: 300 });
    return true;
  }

  let tf: BuktiTfData;
  try {
    tf = await parseBuktiTf(saved.absPath, saved.mimeType);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "spk.tf.ocr.failed");
    await evolution.sendText(ctx.msg.fromNumber, "❌ OCR gagal. Coba kirim ulang atau ketik *skip*.", { delayMs: 300 });
    return true;
  }

  const pct = Math.round(tf.confidence * 100);
  if (tf.confidence < 0.3) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `⚠️ Bukti TF tidak terbaca (${pct}%). Kirim ulang atau ketik *skip*.`,
      { delayMs: 400 }
    );
    return true;
  }

  data.tf = tf;
  data.tf_path = saved.relPath;
  data.tf_skipped = false;

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "CONFIRM", data: data as SpkData });
  return renderConfirm(ctx, data as SpkData);
}

async function renderConfirm(ctx: AuthContext, data: SpkData): Promise<boolean> {
  const v = validateSpk(data.parsed, data.ktp_pembeli, data.ktp_stnk, data.tf);

  const pendings: string[] = [];
  if (data.ktp_pembeli_skipped) pendings.push("KTP_PEMBELI");
  if (data.ktp_stnk_skipped && !data.stnk_sama) pendings.push("KTP_STNK");
  if (data.tf_skipped) pendings.push("TF");
  const status = pendings.length === 0 ? "COMPLETE" : `PENDING_${pendings.join("+")}`;

  const ktpPembeliLine = data.ktp_pembeli_skipped
    ? `KTP Pembeli : _belum dilampirkan_`
    : `KTP Pembeli : ${data.ktp_pembeli?.nama ?? "-"} (${Math.round((data.ktp_pembeli?.confidence ?? 0) * 100)}%)`;

  const ktpStnkLine = data.stnk_sama
    ? `KTP STNK    : _(sama dengan pembeli)_`
    : data.ktp_stnk_skipped
      ? `KTP STNK    : _belum dilampirkan_`
      : `KTP STNK    : ${data.ktp_stnk?.nama ?? "-"} (${Math.round((data.ktp_stnk?.confidence ?? 0) * 100)}%)`;

  const tfLine = data.tf_skipped || !data.tf
    ? `Bukti TF    : _belum dilampirkan_`
    : `Bukti TF    : ${data.tf.bank ?? "-"} · Rp ${data.tf.nominal?.toLocaleString("id-ID") ?? "-"}`;

  const warnBlock = v.warnings.length
    ? `\n⚠️ *Warning:*\n${v.warnings.map((w) => `• ${w}`).join("\n")}\n`
    : "";

  const pendingHint = pendings.length
    ? `\n📌 _Lengkapi nanti: */lengkapi ${data.parsed.spk_an}*_\n`
    : "";

  await evolution.sendText(ctx.msg.fromNumber, [
    `📋 *Konfirmasi SPK · ${data.no_spk_temp}*`,
    `Status: *${status}*`,
    ``,
    `Pembeli  : ${data.parsed.spk_an}`,
    `STNK     : ${data.parsed.stnk}${data.stnk_sama ? " _(sama)_" : ""}`,
    `Type     : ${data.parsed.type} · ${data.parsed.warna}`,
    `Baterai  : ${data.parsed.baterai} · ${data.parsed.pembayaran}`,
    `Booking  : Rp ${data.parsed.booking?.toLocaleString("id-ID")}`,
    `Sales    : ${data.parsed.sales}`,
    ``,
    ktpPembeliLine,
    ktpStnkLine,
    tfLine,
    warnBlock,
    pendingHint,
    `Balas *ya* untuk submit · *batal* untuk batalkan`,
  ].join("\n"), { delayMs: 600 });
  return true;
}

async function stepConfirm(ctx: AuthContext, data: Partial<SpkData>): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();

  if (/^(ya|yes|y|ok|oke|kirim|submit)$/i.test(text)) {
    await submitSpk(ctx, data as SpkData);
    return true;
  }
  if (/^(batal|cancel|tidak|no|n)$/i.test(text)) {
    await clearConvState(ctx.msg.fromNumber);
    await evolution.sendText(ctx.msg.fromNumber, "❌ SPK dibatalkan.", { delayMs: 300 });
    return true;
  }

  await evolution.sendText(ctx.msg.fromNumber, "Balas *ya* untuk submit · *batal* untuk batalkan.", { delayMs: 300 });
  return true;
}

async function submitSpk(ctx: AuthContext, data: SpkData): Promise<void> {
  const v = validateSpk(data.parsed, data.ktp_pembeli, data.ktp_stnk, data.tf);

  const pendings: string[] = [];
  if (data.ktp_pembeli_skipped) pendings.push("KTP_PEMBELI");
  if (data.ktp_stnk_skipped && !data.stnk_sama) pendings.push("KTP_STNK");
  if (data.tf_skipped) pendings.push("TF");
  const status = pendings.length === 0 ? "COMPLETE" : `PENDING_${pendings.join("+")}`;

  const now = new Date().toISOString();

  try {
    await appendRow("Leads_SPK", [
      now,
      data.no_spk_temp,
      ctx.karyawan?.noWa ?? ctx.msg.fromNumber,
      ctx.karyawan?.nama ?? data.parsed.sales ?? "",
      ctx.karyawan?.dealer ?? "",
      data.parsed.spk_an,
      data.parsed.stnk,
      data.ktp_pembeli?.nik ?? "",
      data.ktp_pembeli?.tgl_lahir ?? "",
      data.ktp_pembeli?.alamat ?? "",
      data.parsed.type,
      data.parsed.warna,
      data.parsed.baterai,
      data.parsed.pembayaran,
      data.parsed.booking,
      data.tf?.bank ?? "",
      data.tf?.nominal ?? "",
      data.tf?.berita ?? "",
      data.tf?.no_referensi ?? "",
      status,
      v.warnings.join("; "),
      data.ktp_pembeli_path ?? "",
      data.ktp_stnk_path ?? "",
      data.tf_path ?? "",
      "PENDING_REVIEW",
      "", "", "", "",
    ]);
  } catch (err) {
    logger.error({ err: (err as Error).message, no_spk_temp: data.no_spk_temp }, "spk.submit.failed");
    await evolution.sendText(
      ctx.msg.fromNumber,
      "❌ Gagal simpan ke Sheets. Tim teknis akan dicek. Data masih tersimpan di server.",
      { delayMs: 400 }
    );
    return;
  }

  await clearConvState(ctx.msg.fromNumber);
  logger.info({ no_spk_temp: data.no_spk_temp, sales: ctx.karyawan?.noWa, status }, "spk.submitted");

  const pendingNote = pendings.length
    ? `\n📌 Data pending: ${pendings.join(", ")}\nLengkapi nanti: */lengkapi ${data.parsed.spk_an}*`
    : `\nAdmin penjualan akan konfirmasi segera.`;

  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ *${data.no_spk_temp}* berhasil dikirim.\nStatus: *${status}*${pendingNote}`,
    { delayMs: 500 }
  );
}

export function pushKtpParsed(
  ctx: AuthContext,
  ktp: KtpData,
  relPath: string,
  context: string,
  noSpkTemp: string
): void {
  appendRow("KTP_Parsed", [
    new Date().toISOString(),
    ctx.karyawan?.noWa ?? ctx.msg.fromNumber,
    ktp.nik, ktp.nama, ktp.tempat_lahir, ktp.tgl_lahir, ktp.jenis_kelamin,
    ktp.alamat, ktp.rt_rw, ktp.kelurahan, ktp.kecamatan, ktp.kabupaten, ktp.provinsi,
    ktp.agama, ktp.status_kawin, ktp.pekerjaan, ktp.kewarganegaraan, ktp.berlaku_hingga,
    Math.round((ktp.confidence ?? 0) * 100) / 100,
    relPath,
    context,
    noSpkTemp,
    null,
    null,
  ]).catch((e: Error) => logger.error({ err: e.message }, "spk.ktp_parsed.push.failed"));
}

function labelOf(key: string): string {
  const map: Record<string, string> = {
    spk_an: "SPK a.n",
    stnk: "STNK",
    type: "Type (VF3/VF5/dst)",
    warna: "Warna",
    booking: "Booking (nominal)",
    baterai: "Baterai (sewa/beli)",
    pembayaran: "Pembayaran (cash/kredit)",
    sales: "Sales",
  };
  return map[key] ?? key;
}
