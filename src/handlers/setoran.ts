import type { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";
import { receiveMedia } from "../services/media-receiver.js";
import { parseBuktiTf } from "../services/ocr.js";
import {
  findSpkInLeads,
  appendRow,
  updateRowByNumber,
  type FoundSpk,
} from "../services/sheets.js";
import {
  getConvState,
  setConvState,
  clearConvState,
} from "../services/conv-state.js";
import { logger } from "../services/logger.js";

const FLOW = "setoran";

// 26 kolom — urutan WAJIB match header baris 1 tab Setoran_Pending di Sheets.
export const SETORAN_HEADERS = [
  "timestamp",
  "tanggal",
  "no_spk_temp",
  "nama_pembeli",
  "sales_wa",
  "sales_nama",
  "tipe_mobil",
  "warna",
  "jenis_setoran",
  "tf_bank",
  "tf_nominal",
  "tf_berita",
  "tf_referensi",
  "tf_tanggal_trx",
  "ocr_confidence",
  "foto_tf_path",
  "status",
  "verified_by",
  "verified_at",
  "reject_reason",
  "lengkapi_row",
  "channel",
  "input_method",
  "raw_text",
  "notes",
  "extra",
] as const;

type JenisSetoran = "booking_2" | "dp" | "pelunasan" | "tf" | "lainnya";
type Step = "WAITING_QUERY" | "WAITING_PICK" | "WAITING_JENIS" | "WAITING_PHOTO";

interface SetoranState {
  query: string;
  candidates: FoundSpk[];
  selected: FoundSpk | null;
  jenis: JenisSetoran | null;
  inputMethod: "/setoran" | "/tf";
}

// ─── Entry points ─────────────────────────────────────────────────────────────

export function isSetoranCommand(text: string): boolean {
  return /^\/setoran(\s|$)/i.test(text.trim());
}

export function isTfCommand(text: string): boolean {
  return /^\/tf(\s|$)/i.test(text.trim());
}

export async function handleSetoranCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;
  const rest = (ctx.msg.text ?? "").trim().replace(/^\/setoran\s*/i, "").trim();

  if (!rest) {
    await setConvState(ctx.msg.fromNumber, {
      flow: FLOW,
      step: "WAITING_QUERY",
      data: emptyState("/setoran"),
    });
    await evolution.sendText(
      ctx.msg.fromNumber,
      `💰 *Lapor Setoran*\n\nKetik *nama pembeli* atau *kode SPK*.\nContoh: \`Royyan\` atau \`SPK-DRAFT-2026-05-001\`\n\n_/batal untuk batalkan_`,
      { delayMs: 400 }
    );
    return;
  }

  await startLookup(ctx, rest, "/setoran");
}

export async function handleTfCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;
  const rest = (ctx.msg.text ?? "").trim().replace(/^\/tf\s*/i, "").trim();

  if (!rest) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Format: \`/tf <NO_SPK>\`\nContoh: \`/tf SPK-DRAFT-2026-05-001\``,
      { delayMs: 300 }
    );
    return;
  }

  if (!/^SPK-DRAFT-/i.test(rest)) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `❌ Format SPK tidak valid. Pakai kode lengkap, mis. \`SPK-DRAFT-2026-05-001\`.\nKalau belum tahu kodenya, pakai \`/setoran <nama>\`.`,
      { delayMs: 300 }
    );
    return;
  }

  await evolution.sendText(ctx.msg.fromNumber, `🔍 Mencari ${rest}...`, { delayMs: 200 });

  let candidates: FoundSpk[];
  try {
    candidates = await findSpkInLeads(rest);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "setoran.tf.lookup.failed");
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal akses Sheets. Coba lagi.", { delayMs: 300 });
    return;
  }

  const spk = candidates[0];
  if (!spk) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `❌ SPK *${rest}* tidak ditemukan di Leads_SPK.`,
      { delayMs: 300 }
    );
    return;
  }

  const state: SetoranState = {
    query: rest,
    candidates: [spk],
    selected: spk,
    jenis: "tf",
    inputMethod: "/tf",
  };

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_PHOTO", data: state });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `📸 *${spk.no_spk_temp}* — ${spk.nama_pembeli}\nKirim *foto bukti TF*.\n_/batal untuk batalkan_`,
    { delayMs: 400 }
  );
}

export async function handleSetoranBatal(ctx: AuthContext): Promise<boolean> {
  const state = await getConvState(ctx.msg.fromNumber);
  if (!state || state.flow !== FLOW) return false;
  await clearConvState(ctx.msg.fromNumber);
  await evolution.sendText(ctx.msg.fromNumber, "❌ Setoran dibatalkan.", { delayMs: 300 });
  return true;
}

export async function handleSetoranFlow(ctx: AuthContext): Promise<boolean> {
  const state = await getConvState(ctx.msg.fromNumber);
  if (!state || state.flow !== FLOW) return false;

  const step = state.step as Step;
  const data = state.data as SetoranState;

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

async function stepQuery(ctx: AuthContext, data: SetoranState): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();
  if (!text || ctx.msg.type === "image" || ctx.msg.type === "document") {
    await evolution.sendText(
      ctx.msg.fromNumber,
      "Ketik nama pembeli atau kode SPK (atau /batal).",
      { delayMs: 300 }
    );
    return true;
  }
  await startLookup(ctx, text, data.inputMethod);
  return true;
}

async function stepPick(ctx: AuthContext, data: SetoranState): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim();
  const n = parseInt(text, 10);
  if (!Number.isFinite(n) || n < 1 || n > data.candidates.length) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Ketik nomor 1–${data.candidates.length} (atau /batal).`,
      { delayMs: 300 }
    );
    return true;
  }
  const picked = data.candidates[n - 1];
  if (!picked) return true;
  data.selected = picked;
  await askJenis(ctx, picked, data);
  return true;
}

async function stepJenis(ctx: AuthContext, data: SetoranState): Promise<boolean> {
  const text = (ctx.msg.text ?? "").trim().toLowerCase();
  const jenis = parseJenis(text);

  if (!jenis) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      "Pilih: *1* Booking ke-2, *2* DP, *3* Pelunasan, *4* Lainnya.",
      { delayMs: 300 }
    );
    return true;
  }

  data.jenis = jenis;
  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_PHOTO", data });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `📸 Kirim *foto bukti transfer* untuk *${jenisLabel(jenis)}*.\nSPK: ${data.selected!.no_spk_temp} — ${data.selected!.nama_pembeli}\n_/batal untuk batalkan_`,
    { delayMs: 400 }
  );
  return true;
}

async function stepPhoto(ctx: AuthContext, data: SetoranState): Promise<boolean> {
  if (ctx.msg.type !== "image" && ctx.msg.type !== "document") {
    await evolution.sendText(
      ctx.msg.fromNumber,
      "📸 Kirim *foto* bukti TF (bukan teks). /batal untuk batalkan.",
      { delayMs: 300 }
    );
    return true;
  }

  const spk = data.selected!;
  const jenis = data.jenis ?? "tf";

  await evolution.sendText(ctx.msg.fromNumber, "🔍 Memproses bukti TF...", { delayMs: 200 });

  const saved = await receiveMedia(ctx.msg, {
    category: "SETORAN",
    subfolder: spk.no_spk_temp,
    label: `TF_${jenis.toUpperCase()}`,
  });
  if (!saved) {
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal terima foto. Coba lagi.", { delayMs: 300 });
    return true;
  }

  try {
    await persistSetoran(ctx, spk, jenis, saved.absPath, saved.mimeType, saved.relPath, data.inputMethod);
  } catch (err) {
    logger.error({ err: (err as Error).message, no_spk: spk.no_spk_temp }, "setoran.persist.failed");
    await evolution.sendText(
      ctx.msg.fromNumber,
      "❌ Gagal menyimpan setoran. Kirim ulang fotonya.",
      { delayMs: 300 }
    );
  }
  return true;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistSetoran(
  ctx: AuthContext,
  spk: FoundSpk,
  jenis: JenisSetoran,
  absPath: string,
  mimeType: string,
  relPath: string,
  inputMethod: "/setoran" | "/tf"
): Promise<void> {
  const tf = await parseBuktiTf(absPath, mimeType);
  const pct = Math.round(tf.confidence * 100);

  // <10% → foto tidak terbaca sama sekali, minta kirim ulang
  // 10–30% → simpan dengan flag OCR_LOW, admin verifikasi manual
  if (tf.confidence < 0.1) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `⚠️ Bukti TF tidak terbaca (${pct}%). Kirim ulang dengan foto lebih jelas.`,
      { delayMs: 400 }
    );
    return;
  }

  const now = new Date();
  const tanggal = now.toISOString().slice(0, 10);
  const ts = now.toISOString();

  const rowMap: Record<(typeof SETORAN_HEADERS)[number], string | number | null> = {
    timestamp:       ts,
    tanggal,
    no_spk_temp:     spk.no_spk_temp,
    nama_pembeli:    spk.nama_pembeli,
    sales_wa:        spk.sales_wa,
    sales_nama:      spk.sales_nama,
    tipe_mobil:      spk.tipe_mobil,
    warna:           spk.warna,
    jenis_setoran:   jenis,
    tf_bank:         tf.bank ?? "",
    tf_nominal:      tf.nominal ?? "",
    tf_berita:       tf.berita ?? "",
    tf_referensi:    tf.no_referensi ?? "",
    tf_tanggal_trx:  "",
    ocr_confidence:  tf.confidence,
    foto_tf_path:    relPath,
    status:          tf.confidence < 0.3 ? "PENDING_VERIFIKASI_OCR_LOW" : "PENDING_VERIFIKASI",
    verified_by:     "",
    verified_at:     "",
    reject_reason:   "",
    lengkapi_row:    spk.rowNumber,
    channel:         "bot",
    input_method:    inputMethod,
    raw_text:        (ctx.msg.text ?? "").slice(0, 500),
    notes:           "",
    extra:           "",
  };

  const row = SETORAN_HEADERS.map((h) => rowMap[h] ?? "");
  await appendRow("Setoran_Pending", row);

  const leadsUpdates: Record<string, string | number | null> = {
    notes: appendNote(spk, `setoran ${jenis} via bot ${ts} · ${tf.bank ?? "-"} · ${tf.nominal ?? "-"}`),
  };

  // Kolom opsional di Leads_SPK — updateRowByNumber skip header yang tidak ada
  switch (jenis) {
    case "booking_2":
      leadsUpdates["booking2_bank"]    = tf.bank ?? "";
      leadsUpdates["booking2_nominal"] = tf.nominal ?? "";
      leadsUpdates["booking2_foto"]    = relPath;
      leadsUpdates["booking2_tgl"]     = tanggal;
      break;
    case "dp":
      leadsUpdates["dp_bank"]    = tf.bank ?? "";
      leadsUpdates["dp_nominal"] = tf.nominal ?? "";
      leadsUpdates["dp_foto"]    = relPath;
      leadsUpdates["dp_tgl"]     = tanggal;
      break;
    case "pelunasan":
      leadsUpdates["pelunasan_bank"]    = tf.bank ?? "";
      leadsUpdates["pelunasan_nominal"] = tf.nominal ?? "";
      leadsUpdates["pelunasan_foto"]    = relPath;
      leadsUpdates["pelunasan_tgl"]     = tanggal;
      break;
    case "tf":
    case "lainnya":
      break;
  }

  await updateRowByNumber("Leads_SPK", spk.rowNumber, leadsUpdates);
  await clearConvState(ctx.msg.fromNumber);

  const nominal = tf.nominal
    ? `Rp ${Number(tf.nominal).toLocaleString("id-ID")}`
    : "-";
  await evolution.sendText(
    ctx.msg.fromNumber,
    `✅ Setoran *${jenisLabel(jenis)}* dicatat (${pct}%)\n*${spk.no_spk_temp}* — ${spk.nama_pembeli}\n_${tf.bank ?? "-"} · ${nominal}_\n\nAdmin akan verifikasi.`,
    { delayMs: 500 }
  );
  logger.info(
    { no_spk_temp: spk.no_spk_temp, jenis, bank: tf.bank, nominal: tf.nominal, pct, input_method: inputMethod },
    "setoran.ok"
  );
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

async function startLookup(
  ctx: AuthContext,
  query: string,
  inputMethod: "/setoran" | "/tf"
): Promise<void> {
  await evolution.sendText(ctx.msg.fromNumber, `🔍 Mencari "${query}"...`, { delayMs: 200 });

  let candidates: FoundSpk[];
  try {
    candidates = await findSpkInLeads(query);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "setoran.lookup.failed");
    await evolution.sendText(ctx.msg.fromNumber, "❌ Gagal akses Sheets. Coba lagi.", { delayMs: 400 });
    await clearConvState(ctx.msg.fromNumber);
    return;
  }

  if (candidates.length === 0) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `❌ Tidak ada SPK untuk "${query}".\n\nCoba nama lain atau kode SPK lengkap.`,
      { delayMs: 400 }
    );
    await clearConvState(ctx.msg.fromNumber);
    return;
  }

  const state: SetoranState = { query, candidates, selected: null, jenis: null, inputMethod };

  if (candidates.length === 1) {
    const only = candidates[0];
    if (!only) { await clearConvState(ctx.msg.fromNumber); return; }
    state.selected = only;
    await askJenis(ctx, only, state);
    return;
  }

  const shown = candidates.slice(0, 9);
  const list = shown
    .map((c, i) => `${i + 1}. *${c.nama_pembeli}* · ${c.tipe_mobil}\n   ${c.no_spk_temp}`)
    .join("\n");

  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_PICK", data: state });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `Ditemukan ${candidates.length} SPK untuk "${query}":\n\n${list}\n\nBalas *nomor* (1–${shown.length}).`,
    { delayMs: 500 }
  );
}

async function askJenis(ctx: AuthContext, spk: FoundSpk, state: SetoranState): Promise<void> {
  await setConvState(ctx.msg.fromNumber, { flow: FLOW, step: "WAITING_JENIS", data: state });
  await evolution.sendText(
    ctx.msg.fromNumber,
    `💰 *${spk.no_spk_temp}* — ${spk.nama_pembeli}\n${spk.tipe_mobil} ${spk.warna}\n\nJenis setoran:\n1. Booking ke-2\n2. DP\n3. Pelunasan\n4. Lainnya\n\nBalas nomor atau ketik jenisnya.`,
    { delayMs: 500 }
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function emptyState(inputMethod: "/setoran" | "/tf"): SetoranState {
  return { query: "", candidates: [], selected: null, jenis: null, inputMethod };
}

function parseJenis(text: string): JenisSetoran | null {
  if (text === "1" || /booking\s*[-_ ]?2|booking\s*ke\s*[-_ ]?2|booking2/.test(text)) return "booking_2";
  if (text === "2" || /^dp\b|down\s*payment/.test(text)) return "dp";
  if (text === "3" || /pelunasan|lunas/.test(text)) return "pelunasan";
  if (text === "4" || /lainnya|other/.test(text)) return "lainnya";
  if (/^(tf|transfer|bukti)/.test(text)) return "tf";
  return null;
}

function jenisLabel(j: JenisSetoran): string {
  switch (j) {
    case "booking_2": return "Booking ke-2";
    case "dp":        return "DP";
    case "pelunasan": return "Pelunasan";
    case "tf":        return "TF";
    case "lainnya":   return "Lainnya";
  }
}

function appendNote(spk: FoundSpk, note: string): string {
  const existing = (spk.raw["notes"] ?? "").trim();
  return existing ? `${existing}\n${note}` : note;
}
