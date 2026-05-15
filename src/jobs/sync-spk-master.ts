import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { spk, syncState } from "../db/schema.js";
import { spDownloadFile, spGetFileMeta } from "../services/sharepoint.js";
import { logger } from "../services/logger.js";
import { redis } from "../services/redis.js";
import { env } from "../config/env.js";

const JOB_NAME = "sync_spk_master";
const ETAG_KEY = "sync:spk_master:last_modified";
const SHEET_NAME = "SPK";
const HEADER_ROW = 3;

export interface SyncSpkMasterResult {
  skipped: boolean;
  reason?: string;
  total: number;
  inserted: number;
  updated: number;
  failed: number;
  duration_ms: number;
}

function cellStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o["result"] instanceof Date) return (o["result"] as Date).toISOString().slice(0, 10);
    if ("result" in o) return cellStr(o["result"]);
    if ("text" in o) return cellStr(o["text"]);
    if ("hyperlink" in o) return cellStr(o["text"]);
    if ("richText" in o && Array.isArray(o["richText"])) {
      return cellStr((o["richText"] as Array<{ text?: string }>).map((p) => p.text ?? "").join(""));
    }
    return null;
  }
  if (typeof v === "number") {
    if (v > 40000 && v < 60000) {
      return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
    }
    return String(v);
  }
  const s = String(v).trim();
  return s || null;
}

function cellDate(v: unknown): string | null {
  const s = cellStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]!.padStart(2, "0")}-${m1[1]!.padStart(2, "0")}`;
  return null;
}

function cellNum(v: unknown): string | null {
  const s = cellStr(v);
  if (!s) return null;
  const cleaned = s.replace(/[^\d.-]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return null;
  return cleaned;
}

function buildColMap(ws: ExcelJS.Worksheet, headerRow: number): Record<string, number> {
  const map: Record<string, number> = {};
  ws.getRow(headerRow).eachCell((cell, col) => {
    const raw = cellStr(cell.value);
    if (!raw) return;
    const key = raw.toUpperCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim();
    if (!(key in map)) map[key] = col;
  });
  return map;
}

function pick(map: Record<string, number>, ...names: string[]): number | null {
  for (const n of names) {
    const k = n.toUpperCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim();
    if (map[k] != null) return map[k];
  }
  return null;
}

// Normalize dealer code to canonical (matches spk.chk_spk_dealer check constraint)
function normDealer(s: string | null): string | null {
  if (!s) return null;
  const u = s.toUpperCase();
  if (u.includes("SETIABUDI")) return "SETIABUDI";
  if (u.includes("PASTEUR")) return "PASTEUR";
  if (u.includes("LASWI")) return "LASWI";
  if (u.includes("SOETA") || u.includes("SOEKARNO")) return "SOETA";
  if (u.includes("OMA")) return "OMA";
  return null;
}

export async function syncSpkMaster(opts: { force?: boolean } = {}): Promise<SyncSpkMasterResult> {
  const t0 = Date.now();
  const filePath = env.SP_SPK_FILE;

  if (!filePath) {
    logger.warn("sync.spk_master.skipped: SP_SPK_FILE not set");
    return { skipped: true, reason: "SP_SPK_FILE_not_set", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: 0 };
  }

  let meta: { TimeLastModified: string; Length: string; Name: string };
  try {
    meta = await spGetFileMeta(filePath);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "sync.spk_master.meta_failed");
    return { skipped: true, reason: "meta_failed", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: Date.now() - t0 };
  }

  if (!opts.force) {
    const last = await redis.get(ETAG_KEY);
    if (last === meta.TimeLastModified) {
      return { skipped: true, reason: "no_change", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: Date.now() - t0 };
    }
  }

  const buf = await spDownloadFile(filePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) {
    throw new Error(`Sheet "${SHEET_NAME}" not found. Available: ${wb.worksheets.map((w) => w.name).join(", ")}`);
  }

  const map = buildColMap(ws, HEADER_ROW);

  // Header normalisasi sudah collapse whitespace + strip [.,]; parens & slashes literal.
  // Pick dengan fallback luas — kalau exact match miss, fuzzy match keyword.
  const findByContains = (kw: string): number | null => {
    for (const [k, v] of Object.entries(map)) if (k.includes(kw)) return v;
    return null;
  };
  const c = {
    id:           pick(map, "ID"),
    noSpk:        pick(map, "NO SPK"),
    tglSpkA:      pick(map, "TANGGAL SPK"),
    tglSpkB:      pick(map, "START TIME"),
    tglSpkC:      pick(map, "COMPLETION TIME"),
    namaStnk:     pick(map, "NAMA STNK (SESUAI KTP)", "NAMA STNK"),
    namaPembeli:  pick(map, "NAMA PEMBELI"),
    typeMobil:    pick(map, "TYPE MOBIL", "TIPE MOBIL"),
    warna:        pick(map, "WARNA MOBIL", "WARNA"),
    tipeBaterai:  pick(map, "TIPE BATERAI", "BATERAI"),
    pembayaran:   pick(map, "PEMBAYARAN"),
    salesName:    pick(map, "NAMA TENAGA PEMASAR", "SALES"),
    dealer:       pick(map, "DEALER") ?? findByContains("DEALER"),
    bookingDp:    pick(map, "BOOKING DP TRANSFER (RUPIAH)", "BOOKING DP") ?? findByContains("BOOKING DP"),
  };

  const missing = Object.entries(c).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length > 0) {
    logger.warn({ missing }, "sync.spk_master.missing_columns");
  }

  type Insert = typeof spk.$inferInsert;
  const rows: Insert[] = [];
  const cv = (row: ExcelJS.Row, col: number | null): unknown => (col ? row.getCell(col).value : null);

  ws.eachRow((row, n) => {
    if (n <= HEADER_ROW) return;
    const noSpk = cellStr(cv(row, c.noSpk));
    const id = cellStr(cv(row, c.id));
    const namaPembeli = cellStr(cv(row, c.namaPembeli));
    const namaStnk = cellStr(cv(row, c.namaStnk));
    // Skip baris benar-benar kosong (no identifier dan no nama)
    if (!noSpk && !id && !namaPembeli && !namaStnk) return;

    const raw: Record<string, string | null> = {};
    for (const [k, col] of Object.entries(c)) {
      raw[k] = col ? cellStr(cv(row, col)) : null;
    }

    const tgl =
      cellDate(cv(row, c.tglSpkA)) ??
      cellDate(cv(row, c.tglSpkB)) ??
      cellDate(cv(row, c.tglSpkC));

    rows.push({
      formId:       id ? parseInt(id, 10) || null : null,
      noSpk:        noSpk,
      tglPengajuan: tgl,
      dealer:       normDealer(cellStr(cv(row, c.dealer))),
      tipeMobil:    cellStr(cv(row, c.typeMobil)),
      warna:        cellStr(cv(row, c.warna)),
      tipeBaterai:  cellStr(cv(row, c.tipeBaterai)),
      paymentType:  cellStr(cv(row, c.pembayaran)),
      bookingDp:    cellNum(cv(row, c.bookingDp)),
      bookingDpRaw: cellStr(cv(row, c.bookingDp)),
      salesName:    cellStr(cv(row, c.salesName)),
      source:       "EXCEL_SYNC",
      rawRow:       raw,
    });
  });

  logger.info({ parsed: rows.length, file: filePath }, "sync.spk_master.parsed");

  // Strategi idempotent: hapus semua row source=EXCEL_SYNC lalu insert ulang.
  // Aman karena customer relationships di-link via customerId (set saat OCR/lengkapi, bukan di sync ini).
  await db.delete(spk).where(eq(spk.source, "EXCEL_SYNC"));

  let inserted = 0, updated = 0, failed = 0;
  for (const row of rows) {
    try {
      await db.insert(spk).values(row);
      inserted++;
    } catch (err) {
      failed++;
      logger.warn({ noSpk: row.noSpk, err: (err as Error).message }, "sync.spk_master.row_failed");
    }
  }

  await redis.set(ETAG_KEY, meta.TimeLastModified);

  const result: SyncSpkMasterResult = {
    skipped: false,
    total: rows.length,
    inserted,
    updated,
    failed,
    duration_ms: Date.now() - t0,
  };

  await recordRun(result);
  logger.info(result, "sync.spk_master.done");
  return result;
}

async function recordRun(result: SyncSpkMasterResult): Promise<void> {
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
