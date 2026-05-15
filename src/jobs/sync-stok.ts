import ExcelJS from "exceljs";
import { db } from "../db/client.js";
import { stok, syncState } from "../db/schema.js";
import { spDownloadFile, spGetFileMeta } from "../services/sharepoint.js";
import { logger } from "../services/logger.js";
import { redis } from "../services/redis.js";
import { env } from "../config/env.js";

const JOB_NAME = "sync_stok";
const ETAG_KEY = "sync:stok:last_modified";
const SHEET_NAME = "Stock Unit";
const HEADER_ROW = 7;
const DATA_START = 9; // row 8 has merged/header artifact, real data starts at 9

export interface SyncStokResult {
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
  if (typeof v === "number") return String(v);
  const s = String(v).trim();
  return s || null;
}

function cellInt(v: unknown): number | null {
  const s = cellStr(v);
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d.-]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

// "VFE 34 Brahminy White Including..." → { tipe: "VFE 34", warna: "Brahminy White", baterai: ... }
function splitTipe(combined: string | null): { tipe: string | null; warna: string | null; baterai: string | null } {
  if (!combined) return { tipe: null, warna: null, baterai: null };
  const s = combined.trim();
  // Pattern umum: <TIPE> <WARNA...> [Including <BATERAI>]
  const includingMatch = s.match(/^(.*?)\s+including\s+(.*)$/i);
  const beforeIncluding = includingMatch?.[1]?.trim() ?? s;
  const baterai = includingMatch?.[2]?.trim() ?? null;

  // Heuristic: first 1-2 tokens = tipe (VF3, VF 3, VFE 34, Limo Green, etc.)
  const m = beforeIncluding.match(/^(VF\s*\d+|VFE\s*\d+|Limo\s+\w+)\s+(.+)$/i);
  if (m) return { tipe: m[1]!.trim(), warna: m[2]!.trim(), baterai };
  return { tipe: beforeIncluding, warna: null, baterai };
}

export async function syncStok(opts: { force?: boolean } = {}): Promise<SyncStokResult> {
  const t0 = Date.now();
  const filePath = env.SP_SPK_FILE;

  if (!filePath) {
    logger.warn("sync.stok.skipped: SP_SPK_FILE not set");
    return { skipped: true, reason: "SP_SPK_FILE_not_set", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: 0 };
  }

  let meta: { TimeLastModified: string; Length: string; Name: string };
  try {
    meta = await spGetFileMeta(filePath);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "sync.stok.meta_failed");
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

  // Sheet1 = Form A tracking (Customer + VIN). VIN di sini = sudah dialokasikan = SOLD.
  const soldVins = new Set<string>();
  const sheet1 = wb.getWorksheet("Sheet1");
  if (sheet1) {
    sheet1.eachRow((row, n) => {
      if (n === 1) return;
      const v = cellStr(row.getCell(2).value)?.toUpperCase();
      if (v && v.length === 17) soldVins.add(v);
    });
    logger.info({ count: soldVins.size }, "sync.stok.sold_vins_loaded");
  }

  // Col map from header row 7
  const headerMap: Record<string, number> = {};
  ws.getRow(HEADER_ROW).eachCell((cell, col) => {
    const key = cellStr(cell.value)?.toUpperCase().replace(/\s+/g, " ").trim();
    if (key && !(key in headerMap)) headerMap[key] = col;
  });
  void HEADER_ROW; // satisfy lint

  const cTipe   = headerMap["TYPE MOBIL"]            ?? 2;
  const cJumlah = headerMap["JUMLAH"]                ?? 3;
  const cUmur   = headerMap["UMUR KENDARAAN (HARI)"] ?? 4;
  const cLokasi = headerMap["LOKASI GUDANG"]         ?? 5;
  const cVin    = headerMap["NOMOR VIN"]             ?? 6;
  const cMesin  = headerMap["NOMOR MESIN"]           ?? 7;
  void cJumlah;

  type Insert = typeof stok.$inferInsert;
  const rows: Insert[] = [];

  ws.eachRow((row, n) => {
    if (n < DATA_START) return;
    const vin = cellStr(row.getCell(cVin).value)?.toUpperCase() ?? null;
    if (!vin || vin.length !== 17) return; // stok.vin is the dedup key

    const combined = cellStr(row.getCell(cTipe).value);
    const { tipe, warna, baterai } = splitTipe(combined);

    const isSold = soldVins.has(vin);
    rows.push({
      vin,
      noMesin:     cellStr(row.getCell(cMesin).value),
      tipeMobil:   tipe,
      warna,
      tipeBaterai: baterai,
      lokasi:      cellStr(row.getCell(cLokasi).value),
      status:      isSold ? "SOLD" : "READY",
      umurHari:    cellInt(row.getCell(cUmur).value),
      rawRow:      {
        combined: combined ?? null,
        lokasi:   cellStr(row.getCell(cLokasi).value),
      },
      lastSynced:  new Date(),
    });
  });

  logger.info({ parsed: rows.length, file: filePath }, "sync.stok.parsed");

  // Idempotent: clear table then re-insert. Stok small (<200 rows) so cheap.
  await db.delete(stok);

  let inserted = 0, failed = 0;
  for (const row of rows) {
    try {
      await db.insert(stok).values(row);
      inserted++;
    } catch (err) {
      failed++;
      logger.warn({ vin: row.vin, err: (err as Error).message }, "sync.stok.row_failed");
    }
  }

  await redis.set(ETAG_KEY, meta.TimeLastModified);

  const result: SyncStokResult = {
    skipped: false,
    total: rows.length,
    inserted,
    updated: 0,
    failed,
    duration_ms: Date.now() - t0,
  };

  await recordRun(result);
  logger.info(result, "sync.stok.done");
  return result;
}

async function recordRun(result: SyncStokResult): Promise<void> {
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
