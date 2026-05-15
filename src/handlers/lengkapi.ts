import type { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { receiveMedia } from "../services/media-receiver.js";
import { parseKtp, parseBuktiTf, type KtpData, type BuktiTfData } from "../services/ocr.js";
import { findSpkInLeads, updateRowByNumber, type FoundSpk } from "../services/sheets.js";
import { getConvState, setConvState, clearConvState } from "../services/conv-state.js";
import { logger } from "../services/logger.js";
import { pushKtpParsed } from "./spk.js";

const FLOW = "lengkapi";

type JenisLengkapi = "ktp_pembeli" | "ktp_stnk" | "tf";
type Step = "WAITING_QUERY" | "WAITING_PICK" | "WAITING_JENIS" | "WAITING_PHOTO";

interface LengkapiState {
  query: string;
  candidates: FoundSpk[];
  selected: FoundSpk | null;
  jenis: JenisLengkapi | null;
}

export function isLengkapiCommand(text: string): boolean {
  return /^\/lengkapi(\s|$)/i.test(text.trim());
}

export async function handleLengkapiCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;
  const rest = (ctx.msg.text ?? "").trim().replace(/^\/lengkapi\s*/i, "").trim();

  if (!rest) {
    await setConvState(ctx.msg.fromNumber, {
      flow: FLOW,
      step: "WAITING_QUERY",
      data: { query: "", candidates: [], selected: null, jenis: null } as LengkapiState,
    });
    await evolution.sendText(
      ctx.msg.fromNumber,
      `🔍 *Lengkapi SPK*\n\nKetik *nama pembeli* atau *kode SPK* untuk dicari.\nContoh: \`Royyan\` atau \`SPK-DRAFT-2026-05-001\`\n\n_/batal untuk batalkan_`,
      { delayMs: 400 }
    );
    return;
  }

  await startLookup(ctx, rest);
}

export async function handleLengkapiBatal(ctx: AuthContext): Promise<boolean> {
  const state = await getConvState(ctx.msg.fromNumber);
  if (!state || state.flow !== FLOW) return false;
  await clearConvState(ctx.msg.fromNumber);
  await evolution.sendText(ctx.msg.fromNumber, "❌ Lengkapi dibatalkan.", { delayMs: 300 });
  return true;
}

export async function handleLengkapiFlow(ctx: AuthContext): Promise<boolean> {
  const state = await getConvState(ctx.msg.fromNumber);
  if (!state || state.flow !== FLOW) return false;

  const step = state.step as Step;
  const data = state.data as LengkapiState;

  switch (step) {
    case "WAITING_QUERY": return stepQuery(ctx, data);
    case "WAITING_PICK":  return stepPick(ctx, data);
    case "WAITING_JENIS": return stepJenis(ctx, data);
    case "WAITING_PHOTO": return stepPhoto(ctx, data);
    default:
      await clearConvState(ctx.msg.fromNumber);
      return false;
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function stepQuery(ctx: AuthContext, _data: LengkapiState): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();
  if (!text || ctx.msg.type === "image" || ctx.msg.type === "document") {
    await evolution.sendText(ctx.msg.fromNumber, "Ketik nama pembeli atau kode SPK (atau /batal).", { delayMs: 300 });
    return true;
  }
  await startLookup(ctx, text);
  return true;
}

async function stepPick(ctx: AuthContext, data: LengkapiState): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();
  const n = parseInt(text, 10);
  if (!Number.isFinite(n) || n < 1 || n > data.candidates.length) {
    await evolution.sendText(ctx.msg.fromNumber, `Ketik nomor 1–${data.candidates.length} (atau /batal).`, { delayMs: 300 });
    return true;
  }
  const picked = data.candidates[n - 1];
  if (!picked) return true;
  data.selected = picked;
  await askJenis(ctx, picked, data);
  return true;
}

async function stepJenis(ctx: AuthContext, data: LengkapiState): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim().toLowerCase();
  const pendings = parsePendings(data.selected!.status_lengkap);

  let jenis: JenisLengkapi | null = null;
  if (text === "1" || /ktp\s*pembeli/.test(text)) {
    jenis = pendings.includes("KTP_PEMBELI") ? "ktp_pembeli" : null;
  } else if (text === "2" || /ktp\s*stnk/.test(text)) {
    jenis = pendings.includes("KTP_STNK") ? "ktp_stnk" :
            pendings.includes("KTP_PEMBELI") ? null : "ktp_stnk";
  } else if (text === "3" || /^(tf|transfer|bukti)/.test(text)) {
    jenis = "tf";
  }

  // numeric pick maps to ordered pending list
  if (!jenis && /^\d+$/.test(text)) {
    const idx = parseInt(text, 10) - 1;
    const ordered = pendingsOrdered(pendings);
    if (idx >= 0 && idx < ordered.length) {
      jenis = ordered[idx] as JenisLengkapi;
    }
  }

  if (!jenis) {
    await evolution.sendText(ctx.msg.fromNumber, "Pilih nomor yang tersedia, atau ketik *ktp pembeli* / *ktp stnk* / *tf*.", { delayMs: 300 });
    return true;
  }

  data.jenis = jenis;
  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_PHOTO", data });

  const label = jenisLabel(jenis);
  await evolution.sendText(
    ctx.msg.fromNumber,
    `📸 Kirim foto *${label}* untuk *${data.selected!.no_spk_temp}*.\n_/batal untuk batalkan_`,
    { delayMs: 400 }
  );
  return true;
}

async function stepPhoto(ctx: AuthContext, data: LengkapiState): Promise<boolean> {
  if (ctx.msg.type !== "image" && ctx.msg.type !== "document") {
    await evolution.sendText(ctx.msg.fromNumber, "📸 Kirim *foto* dokumennya (bukan teks). /batal untuk batalkan.", { delayMs: 300 });
    return true;
  }

  const spk = data.selected!;
  const jenis = data.jenis!;

  await evolution.sendText(ctx.msg.fromNumber, "🔍 Memproses...", { delayMs: 200 });

  const labelUpper = jenis === "ktp_pembeli" ? "KTP_PEMBELI" : jenis === "ktp_stnk" ? "KTP_STNK" : "BUKTI_TF";
  const saved = await receiveMedia(ctx.msg, { category: "SPK", subfolder: spk.no_spk_temp, label: labelUpper });
  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal terima foto. Coba lagi.", { delayMs: 300 });
    return true;
  }

  try {
    if (jenis === "tf") {
      await handleTfUpload(ctx, spk, saved.absPath, saved.mimeType, saved.relPath);
    } else {
      await handleKtpUpload(ctx, spk, jenis, saved.absPath, saved.mimeType, saved.relPath);
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, "lengkapi.ocr.failed");
    await evolution.sendText(ctx.msg.fromNumber, "❌ OCR gagal. Kirim ulang fotonya.", { delayMs: 300 });
  }
  return true;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleKtpUpload(
  ctx: AuthContext,
  spk: FoundSpk,
  jenis: "ktp_pembeli" | "ktp_stnk",
  absPath: string,
  mimeType: string,
  relPath: string
): Promise<void> {
  const ktp = await parseKtp(absPath, mimeType);
  const pct = Math.round(ktp.confidence * 100);
  if (ktp.confidence < 0.3) {
    await evolution.sendText(ctx.msg.fromNumber, `⚠️ KTP tidak terbaca (${pct}%). Kirim ulang.`, { delayMs: 400 });
    return;
  }

  const updates: Record<string, string | number | null> = {};
  if (jenis === "ktp_pembeli") {
    updates["nik_pembeli"]       = ktp.nik ?? "";
    updates["tgl_lahir_pembeli"] = ktp.tgl_lahir ?? "";
    updates["alamat_pembeli"]    = ktp.alamat ?? "";
    updates["foto_ktp_pembeli"]  = relPath;
  } else {
    updates["foto_ktp_stnk"] = relPath;
  }
  updates["status_lengkap"] = recomputeStatus(spk, jenis === "ktp_pembeli" ? "KTP_PEMBELI" : "KTP_STNK");
  updates["notes"] = appendNote(spk, `${jenis} dilengkapi via bot ${new Date().toISOString()}`);

  await updateRowByNumber("Leads_SPK", spk.rowNumber, updates);
  pushKtpParsed(ctx, ktp, relPath,
    jenis === "ktp_pembeli" ? "LENGKAPI_KTP_PEMBELI" : "LENGKAPI_KTP_STNK",
    spk.no_spk_temp
  );
  await clearConvState(ctx.msg.fromNumber);

  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ *${spk.no_spk_temp}* — ${jenisLabel(jenis)} ditambahkan (${pct}%)\n_nama: ${ktp.nama ?? "-"} · NIK: ${ktp.nik ?? "-"}_`,
    { delayMs: 500 }
  );
  logger.info({ no_spk_temp: spk.no_spk_temp, jenis, pct }, "lengkapi.ktp.ok");
}

async function handleTfUpload(
  ctx: AuthContext,
  spk: FoundSpk,
  absPath: string,
  mimeType: string,
  relPath: string
): Promise<void> {
  const tf = await parseBuktiTf(absPath, mimeType);
  const pct = Math.round(tf.confidence * 100);
  if (tf.confidence < 0.3) {
    await evolution.sendText(ctx.msg.fromNumber, `⚠️ Bukti TF tidak terbaca (${pct}%). Kirim ulang.`, { delayMs: 400 });
    return;
  }

  await updateRowByNumber("Leads_SPK", spk.rowNumber, {
    tf_bank:        tf.bank ?? "",
    tf_nominal:     tf.nominal ?? "",
    tf_berita:      tf.berita ?? "",
    tf_referensi:   tf.no_referensi ?? "",
    foto_tf:        relPath,
    status_lengkap: recomputeStatus(spk, "TF"),
    notes:          appendNote(spk, `TF dilengkapi via bot ${new Date().toISOString()}`),
  });
  await clearConvState(ctx.msg.fromNumber);

  const nominal = tf.nominal ? `Rp ${tf.nominal.toLocaleString("id-ID")}` : "-";
  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ *${spk.no_spk_temp}* — Bukti TF ditambahkan (${pct}%)\n_${tf.bank ?? "-"} · ${nominal} · "${tf.berita ?? "-"}"_`,
    { delayMs: 500 }
  );
  logger.info({ no_spk_temp: spk.no_spk_temp, nominal: tf.nominal, pct }, "lengkapi.tf.ok");
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function startLookup(ctx: AuthContext, query: string): Promise<void> {
  await evolution.sendText(ctx.msg.fromNumber, `🔍 Mencari "${query}"...`, { delayMs: 200 });

  let candidates: FoundSpk[];
  try {
    candidates = await findSpkInLeads(query);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "lengkapi.lookup.failed");
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal akses Sheets. Coba lagi.", { delayMs: 400 });
    await clearConvState(ctx.msg.fromNumber);
    return;
  }

  if (candidates.length === 0) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `❌ Tidak ada SPK untuk "${query}".\n\nCoba nama lain atau kode SPK lengkap (mis. SPK-DRAFT-2026-05-001).`,
      { delayMs: 400 }
    );
    await clearConvState(ctx.msg.fromNumber);
    return;
  }

  const state: LengkapiState = { query, candidates, selected: null, jenis: null };

  if (candidates.length === 1) {
    const only = candidates[0];
    if (!only) { await clearConvState(ctx.msg.fromNumber); return; }
    state.selected = only;
    await askJenis(ctx, only, state);
    return;
  }

  // multiple matches → picker (max 9)
  const shown = candidates.slice(0, 9);
  const list = shown.map((c, i) => {
    const pendings = parsePendings(c.status_lengkap);
    const tag = pendings.length ? ` _[${pendings.join("+")}]_` : ` _[lengkap]_`;
    return `${i + 1}. *${c.nama_pembeli}* · ${c.tipe_mobil}\n   ${c.no_spk_temp}${tag}`;
  }).join("\n");

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_PICK", data: state });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `Ditemukan ${candidates.length} SPK untuk "${query}":\n\n${list}\n\nBalas *nomor* (1–${shown.length}) untuk pilih.`,
    { delayMs: 500 }
  );
}

async function askJenis(ctx: AuthContext, spk: FoundSpk, state: LengkapiState): Promise<void> {
  const pendings = parsePendings(spk.status_lengkap);

  if (pendings.length === 0) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `✅ *${spk.no_spk_temp}* (${spk.nama_pembeli}) sudah lengkap.`,
      { delayMs: 400 }
    );
    await clearConvState(ctx.msg.fromNumber);
    return;
  }

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_JENIS", data: state });

  const ordered = pendingsOrdered(pendings);
  const options = ordered.map((p, i) => `${i + 1}. ${jenisLabel(p as JenisLengkapi)}`).join("\n");

  await evolution.sendText(
    ctx.msg.fromNumber,
    `📋 *${spk.no_spk_temp}* — ${spk.nama_pembeli}\n${spk.tipe_mobil} ${spk.warna}\n\nYang masih kurang:\n${options}\n\nBalas nomor atau ketik jenisnya.`,
    { delayMs: 500 }
  );
}

function parsePendings(status: string): string[] {
  if (!status || /^complete$/i.test(status)) return [];
  const m = status.match(/^pending_(.+)$/i);
  if (!m || !m[1]) return [];
  return m[1].split("+").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function pendingsOrdered(pendings: string[]): string[] {
  const ORDER = ["ktp_pembeli", "ktp_stnk", "tf"];
  return ORDER.filter((p) => pendings.includes(p.toUpperCase().replace("_", "_")));
}

function jenisLabel(jenis: JenisLengkapi | string): string {
  if (jenis === "ktp_pembeli" || jenis === "KTP_PEMBELI") return "KTP Pembeli";
  if (jenis === "ktp_stnk"    || jenis === "KTP_STNK")    return "KTP STNK";
  return "Bukti Transfer";
}

function recomputeStatus(spk: FoundSpk, justAdded: string): string {
  const current = parsePendings(spk.status_lengkap);
  const remaining = current.filter((p) => p !== justAdded.toUpperCase());
  return remaining.length === 0 ? "COMPLETE" : `PENDING_${remaining.join("+")}`;
}

function appendNote(spk: FoundSpk, note: string): string {
  const existing = (spk.raw["notes"] ?? "").trim();
  return existing ? `${existing}\n${note}` : note;
}
