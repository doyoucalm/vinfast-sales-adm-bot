import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { ompangTracking, syncState } from "../db/schema.js";
import { spDownloadFile, spGetFileMeta } from "../services/sharepoint.js";
import { logger } from "../services/logger.js";
import { redis } from "../services/redis.js";
import { env } from "../config/env.js";

const JOB_NAME = "sync_ompang";
const ETAG_KEY = "sync:ompang:last_modified";

export interface SyncOmpangResult {
  skipped: boolean;
  reason?: string;
  total: number;
  inserted: number;
  updated: number;
  failed: number;
  duration_ms: number;
}

type SheetMap = Map<string, Record<string, unknown>>;

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o["result"] instanceof Date) return (o["result"] as Date).toISOString().slice(0, 10);
    if ("result" in o) return String(o["result"] ?? "").trim();
    if ("text" in o) return String(o["text"] ?? "").trim();
    return "";
  }
  return String(v).trim();
}

function cellDate(v: unknown): string | null {
  const s = cellStr(v);
  if (!s) return null;
  const n = Number(s);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const m1 = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]!.padStart(2, "0")}-${m1[1]!.padStart(2, "0")}`;
  const m2 = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2]!.padStart(2, "0")}-${m2[3]!.padStart(2, "0")}`;
  return s || null;
}

function cellNumeric(v: unknown): string | null {
  const s = cellStr(v).replace(/[Rp.,\s]/gi, "");
  return s || null;
}

function buildColMap(ws: ExcelJS.Worksheet): Record<string, number> {
  const map: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const k = cellStr(cell.value).toLowerCase().replace(/\s+/g, "_");
    if (k) map[k] = col;
  });
  return map;
}

function resolve(colMap: Record<string, number>, aliases: string[]): number | null {
  for (const a of aliases) {
    const idx = colMap[a.toLowerCase().replace(/\s+/g, "_")];
    if (idx) return idx;
  }
  return null;
}

function cv(row: ExcelJS.Row, col: number | null): unknown {
  return col ? row.getCell(col).value : null;
}

function parseOmpangSheet(ws: ExcelJS.Worksheet): SheetMap {
  const c = buildColMap(ws);
  const cVin  = resolve(c, ["no_rangka", "vin", "nomor_rangka", "no._rangka", "no_vin"]);
  const cNama = resolve(c, ["nama_stnk", "nama", "nama_pemilik", "atas_nama"]);
  const cTipe = resolve(c, ["tipe", "tipe_mobil", "model", "tipe_kendaraan"]);
  const cPay  = resolve(c, ["payment", "metode_bayar", "cara_bayar", "pembayaran"]);
  const cDom  = resolve(c, ["domisili", "kota", "kab/kota", "kabkota"]);
  const cTgl1 = resolve(c, ["tgl_pengajuan", "tgl_pengajuan_ompang", "tanggal_pengajuan", "tgl_submit"]);
  const cTgl2 = resolve(c, ["tgl_penerimaan", "tgl_terima", "tgl_penerimaan_ompang", "tanggal_terima"]);
  const cTgl3 = resolve(c, ["tgl_serah_terima", "tgl_serah", "tgl_serah_terima_ompang", "tanggal_serah"]);

  const out: SheetMap = new Map();
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const vin = cellStr(cv(row, cVin)).toUpperCase();
    if (!vin) return;
    out.set(vin, {
      namaStnk:             cv(row, cNama),
      tipeMobil:            cv(row, cTipe),
      payment:              cv(row, cPay),
      domisili:             cv(row, cDom),
      tglPengajuanOmpang:   cv(row, cTgl1),
      tglPenerimaanOmpang:  cv(row, cTgl2),
      tglSerahTerimaOmpang: cv(row, cTgl3),
    });
  });
  return out;
}

function parseFakturSheet(ws: ExcelJS.Worksheet): SheetMap {
  const c = buildColMap(ws);
  const cVin  = resolve(c, ["no_rangka", "vin", "nomor_rangka", "no._rangka"]);
  const cTgl1 = resolve(c, ["tgl_pengajuan", "tgl_pengajuan_faktur", "tanggal_pengajuan"]);
  const cTgl2 = resolve(c, ["tgl_penerimaan", "tgl_penerimaan_faktur", "tanggal_penerimaan"]);
  const cStat = resolve(c, ["status", "status_faktur", "ket", "keterangan"]);
  const cInv  = resolve(c, ["no_invoice", "nomor_invoice", "no._invoice", "invoice"]);
  const cNom  = resolve(c, ["nominal", "nominal_payment", "harga", "nilai"]);

  const out: SheetMap = new Map();
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const vin = cellStr(cv(row, cVin)).toUpperCase();
    if (!vin) return;
    out.set(vin, {
      tglPengajuanFaktur:  cv(row, cTgl1),
      tglPenerimaanFaktur: cv(row, cTgl2),
      statusFaktur:        cv(row, cStat),
      noInvoice:           cv(row, cInv),
      nominalPayment:      cv(row, cNom),
    });
  });
  return out;
}

function parseStnkSheet(ws: ExcelJS.Worksheet): SheetMap {
  const c = buildColMap(ws);
  const cVin  = resolve(c, ["no_rangka", "vin", "nomor_rangka", "no._rangka"]);
  const cTgl1 = resolve(c, ["tgl_pengajuan", "tgl_pengajuan_stnk", "tgl_permohonan", "tanggal_pengajuan"]);
  const cNo1  = resolve(c, ["no_surat_pengajuan", "nomor_surat_pengajuan", "no._surat_pengajuan"]);
  const cTgl2 = resolve(c, ["tgl_penerimaan", "tgl_penerimaan_stnk", "tgl_terima_stnk", "tanggal_penerimaan"]);
  const cNo2  = resolve(c, ["no_surat_penerimaan", "nomor_surat_penerimaan", "no._surat_penerimaan"]);
  const cTgl3 = resolve(c, ["tgl_serah_terima", "tgl_penyerahan_stnk", "tgl_serah_stnk", "tanggal_serah"]);
  const cNo3  = resolve(c, ["no_surat_serah", "nomor_surat_serah", "no._surat_penyerahan"]);

  const out: SheetMap = new Map();
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const vin = cellStr(cv(row, cVin)).toUpperCase();
    if (!vin) return;
    out.set(vin, {
      tglPengajuanStnkBpkb:  cv(row, cTgl1),
      noSuratPengajuan:      cv(row, cNo1),
      tglPenerimaanStnk:     cv(row, cTgl2),
      noSuratPenerimaanStnk: cv(row, cNo2),
      tglSerahTerimaStnk:    cv(row, cTgl3),
      noSuratSerahStnk:      cv(row, cNo3),
    });
  });
  return out;
}

function parseBpkbSheet(ws: ExcelJS.Worksheet): SheetMap {
  const c = buildColMap(ws);
  const cVin  = resolve(c, ["no_rangka", "vin", "nomor_rangka", "no._rangka"]);
  const cTgl1 = resolve(c, ["tgl_penerimaan_bpkb", "tgl_terima_bpkb", "tgl_penerimaan_bpkb_biro", "tanggal_penerimaan_bpkb"]);
  const cTgl2 = resolve(c, ["tgl_serah_terima_bpkb", "tgl_penyerahan_bpkb", "tgl_serah_bpkb", "tanggal_serah_bpkb"]);
  const cNo   = resolve(c, ["no_surat_serah_bpkb", "nomor_surat_bpkb", "no._surat_bpkb"]);

  const out: SheetMap = new Map();
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const vin = cellStr(cv(row, cVin)).toUpperCase();
    if (!vin) return;
    out.set(vin, {
      tglPenerimaanBpkbBiro: cv(row, cTgl1),
      tglSerahTerimaBpkb:    cv(row, cTgl2),
      noSuratSerahBpkb:      cv(row, cNo),
    });
  });
  return out;
}

function buildMergedRow(
  vin: string,
  o: Record<string, unknown>,
  f: Record<string, unknown>,
  s: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  return {
    vin,
    namaStnk:              cellStr(o["namaStnk"]) || null,
    tipeMobil:             cellStr(o["tipeMobil"]) || null,
    payment:               cellStr(o["payment"]) || null,
    domisili:              cellStr(o["domisili"]) || null,
    tglPengajuanOmpang:    cellDate(o["tglPengajuanOmpang"]),
    tglPenerimaanOmpang:   cellDate(o["tglPenerimaanOmpang"]),
    tglSerahTerimaOmpang:  cellDate(o["tglSerahTerimaOmpang"]),
    tglPengajuanFaktur:    cellDate(f["tglPengajuanFaktur"]),
    tglPenerimaanFaktur:   cellDate(f["tglPenerimaanFaktur"]),
    statusFaktur:          cellStr(f["statusFaktur"]) || null,
    noInvoice:             cellStr(f["noInvoice"]) || null,
    nominalPayment:        cellNumeric(f["nominalPayment"]),
    tglPengajuanStnkBpkb:  cellDate(s["tglPengajuanStnkBpkb"]),
    noSuratPengajuan:      cellStr(s["noSuratPengajuan"]) || null,
    tglPenerimaanStnk:     cellDate(s["tglPenerimaanStnk"]),
    noSuratPenerimaanStnk: cellStr(s["noSuratPenerimaanStnk"]) || null,
    tglSerahTerimaStnk:    cellDate(s["tglSerahTerimaStnk"]),
    noSuratSerahStnk:      cellStr(s["noSuratSerahStnk"]) || null,
    tglPenerimaanBpkbBiro: cellDate(b["tglPenerimaanBpkbBiro"]),
    tglSerahTerimaBpkb:    cellDate(b["tglSerahTerimaBpkb"]),
    noSuratSerahBpkb:      cellStr(b["noSuratSerahBpkb"]) || null,
    rawRow: { ompang: o, faktur: f, stnk: s, bpkb: b } as Record<string, unknown>,
    lastSynced: new Date(),
  };
}

async function parseExcel(buf: Buffer): Promise<{
  vins: string[];
  merged: Map<string, ReturnType<typeof buildMergedRow>>;
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const findSheet = (...names: string[]): ExcelJS.Worksheet | undefined => {
    for (const n of names) {
      const ws = wb.worksheets.find((w) => w.name.toLowerCase().includes(n.toLowerCase()));
      if (ws) return ws;
    }
    return undefined;
  };

  const wsOmpang = findSheet("ompang", "balik nama", "data");
  const wsFaktur = findSheet("faktur", "invoice");
  const wsStnk   = findSheet("stnk", "polisi");
  const wsBpkb   = findSheet("bpkb", "buku");

  if (!wsOmpang) {
    throw new Error(
      `Sheet "Ompang" tidak ditemukan. Available: ${wb.worksheets.map((w) => w.name).join(", ")}`
    );
  }

  const ompangMap = parseOmpangSheet(wsOmpang);
  const fakturMap = wsFaktur ? parseFakturSheet(wsFaktur) : new Map<string, Record<string, unknown>>();
  const stnkMap   = wsStnk   ? parseStnkSheet(wsStnk)     : new Map<string, Record<string, unknown>>();
  const bpkbMap   = wsBpkb   ? parseBpkbSheet(wsBpkb)     : new Map<string, Record<string, unknown>>();

  const allVins = new Set([
    ...ompangMap.keys(), ...fakturMap.keys(), ...stnkMap.keys(), ...bpkbMap.keys(),
  ]);

  const merged = new Map<string, ReturnType<typeof buildMergedRow>>();
  for (const vin of allVins) {
    merged.set(vin, buildMergedRow(
      vin,
      ompangMap.get(vin) ?? {},
      fakturMap.get(vin) ?? {},
      stnkMap.get(vin) ?? {},
      bpkbMap.get(vin) ?? {},
    ));
  }

  return { vins: [...allVins], merged };
}

export async function syncOmpang(opts: { force?: boolean } = {}): Promise<SyncOmpangResult> {
  const t0 = Date.now();
  const filePath = env.SP_OMPANG_FILE;

  if (!filePath) {
    logger.warn("sync.ompang.skipped: SP_OMPANG_FILE not set");
    return { skipped: true, reason: "SP_OMPANG_FILE_not_set", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: 0 };
  }

  let meta: { TimeLastModified: string; Length: string; Name: string };
  try {
    meta = await spGetFileMeta(filePath);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "sync.ompang.meta_failed");
    return { skipped: true, reason: "meta_failed", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: Date.now() - t0 };
  }

  if (!opts.force) {
    const last = await redis.get(ETAG_KEY);
    if (last === meta.TimeLastModified) {
      logger.debug({ TimeLastModified: meta.TimeLastModified }, "sync.ompang.no_change");
      return { skipped: true, reason: "no_change", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: Date.now() - t0 };
    }
  }

  const buf = await spDownloadFile(filePath);
  const { vins, merged } = await parseExcel(buf);
  logger.info({ count: vins.length, file: filePath }, "sync.ompang.parsed");

  const existing = await db.select({ vin: ompangTracking.vin }).from(ompangTracking);
  const existingVins = new Set(existing.map((r) => r.vin));

  let inserted = 0, updated = 0, failed = 0;

  for (const [vin, row] of merged) {
    try {
      if (!existingVins.has(vin)) {
        await db.insert(ompangTracking).values(row);
        inserted++;
      } else {
        await db.update(ompangTracking).set(row).where(eq(ompangTracking.vin, vin));
        updated++;
      }
    } catch (err) {
      failed++;
      logger.warn({ vin, err: (err as Error).message }, "sync.ompang.row_failed");
    }
  }

  await redis.set(ETAG_KEY, meta.TimeLastModified);

  const result: SyncOmpangResult = {
    skipped: false, total: vins.length, inserted, updated, failed, duration_ms: Date.now() - t0,
  };
  await recordRun(result);
  logger.info(result, "sync.ompang.done");
  return result;
}

async function recordRun(result: SyncOmpangResult): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({
      jobName: JOB_NAME,
      lastRunAt: now,
      lastSuccessAt: result.failed === 0 ? now : null,
      lastResult: result as unknown as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: syncState.jobName,
      set: {
        lastRunAt: now,
        lastSuccessAt: result.failed === 0 ? now : undefined,
        lastResult: result as unknown as Record<string, unknown>,
      },
    });
}
