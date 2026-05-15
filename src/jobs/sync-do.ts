import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { doLog, syncState } from "../db/schema.js";
import { spDownloadFile, spGetFileMeta } from "../services/sharepoint.js";
import { logger } from "../services/logger.js";
import { redis } from "../services/redis.js";
import { env } from "../config/env.js";

const JOB_NAME = "sync_do";
const ETAG_KEY = "sync:do:last_modified";
const HEADER_ROW = 1;

export interface SyncDoResult {
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

function cellInt(v: unknown): number | null {
  const s = cellStr(v);
  if (!s) return null;
  const n = parseInt(s.replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? null : n;
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

export async function syncDo(opts: { force?: boolean } = {}): Promise<SyncDoResult> {
  const t0 = Date.now();
  const filePath = env.SP_DO_FILE;
  const sheetName = env.SP_DO_SHEET;

  if (!filePath) {
    logger.warn("sync.do.skipped: SP_DO_FILE not set");
    return { skipped: true, reason: "SP_DO_FILE_not_set", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: 0 };
  }

  let meta: { TimeLastModified: string; Length: string; Name: string };
  try {
    meta = await spGetFileMeta(filePath);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "sync.do.meta_failed");
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

  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    throw new Error(`Sheet "${sheetName}" not found. Available: ${wb.worksheets.map((w) => w.name).join(", ")}`);
  }

  const map = buildColMap(ws, HEADER_ROW);

  const c = {
    tglDo:     pick(map, "TGL DO", "TANGGAL DO"),
    vin:       pick(map, "NO RANGKA", "VIN", "NOMOR VIN"),
    noMesin:   pick(map, "NO MESIN", "NOMOR MESIN"),
    type:      pick(map, "TYPE", "TIPE", "TIPE MOBIL"),
    warna:     pick(map, "WARNA"),
    tahunUnit: pick(map, "TAHUN UNIT", "TAHUN"),
    namaStnk:  pick(map, "NAMA STNK", "NAMA"),
    noHp:      pick(map, "NO HP", "NOMOR HP"),
    noKtp:     pick(map, "NO KTP", "NOMOR KTP"),
    pembayaran: pick(map, "PEMBAYARAN (KREDIT / TUNAI)", "PEMBAYARAN"),
    alamat:    pick(map, "ALAMAT"),
    dealerSj:  pick(map, "DEALER SJ", "DEALER"),
  };

  const missing = Object.entries(c).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length > 0) {
    logger.warn({ missing }, "sync.do.missing_columns");
  }

  type Insert = typeof doLog.$inferInsert;
  const rows: Insert[] = [];
  const cv = (row: ExcelJS.Row, col: number | null): unknown => (col ? row.getCell(col).value : null);

  ws.eachRow((row, n) => {
    if (n <= HEADER_ROW) return;
    const vin = cellStr(cv(row, c.vin))?.toUpperCase() ?? null;
    if (!vin || vin.length !== 17) return; // skip rows tanpa VIN valid (do_log.vin NOT NULL)

    const raw: Record<string, string | null> = {};
    for (const [k, col] of Object.entries(c)) {
      raw[k] = col ? cellStr(cv(row, col)) : null;
    }

    rows.push({
      vin,
      noMesin:    cellStr(cv(row, c.noMesin)),
      tipeMobil:  cellStr(cv(row, c.type)),
      warna:      cellStr(cv(row, c.warna)),
      tahunUnit:  cellInt(cv(row, c.tahunUnit)),
      namaStnk:   cellStr(cv(row, c.namaStnk)),
      noHp:       cellStr(cv(row, c.noHp)),
      noKtp:      cellStr(cv(row, c.noKtp)),
      pembayaran: cellStr(cv(row, c.pembayaran)),
      alamat:     cellStr(cv(row, c.alamat)),
      dealerSj:   cellStr(cv(row, c.dealerSj)),
      tglDo:      cellDate(cv(row, c.tglDo)),
      rawRow:     raw,
      lastSynced: new Date(),
    });
  });

  logger.info({ parsed: rows.length, file: filePath }, "sync.do.parsed");

  const existing = await db.select({ vin: doLog.vin }).from(doLog);
  const existingVins = new Set(existing.map((r) => r.vin));

  let inserted = 0, updated = 0, failed = 0;
  for (const row of rows) {
    try {
      if (existingVins.has(row.vin)) {
        await db.update(doLog).set(row).where(eq(doLog.vin, row.vin));
        updated++;
      } else {
        await db.insert(doLog).values(row);
        inserted++;
        existingVins.add(row.vin);
      }
    } catch (err) {
      failed++;
      logger.warn({ vin: row.vin, err: (err as Error).message }, "sync.do.row_failed");
    }
  }

  await redis.set(ETAG_KEY, meta.TimeLastModified);

  const result: SyncDoResult = {
    skipped: false,
    total: rows.length,
    inserted,
    updated,
    failed,
    duration_ms: Date.now() - t0,
  };

  await recordRun(result);
  logger.info(result, "sync.do.done");
  return result;
}

async function recordRun(result: SyncDoResult): Promise<void> {
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
