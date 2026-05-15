import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { ompangTracking, syncState } from "../db/schema.js";
import { spDownloadFile, spGetFileMeta } from "../services/sharepoint.js";
import { logger } from "../services/logger.js";
import { redis } from "../services/redis.js";
import { env } from "../config/env.js";

const JOB_NAME = "sync_ompang";
const ETAG_KEY = "sync:ompang:last_modified";
const HEADER_ROW = 6;

export interface SyncOmpangResult {
  skipped: boolean;
  reason?: string;
  total: number;
  inserted: number;
  updated: number;
  failed: number;
  duration_ms: number;
}

// Parse one cell into a text value suitable for storage.
// - Date object → ISO date string (YYYY-MM-DD)
// - Excel serial number (40000–60000) → ISO date string
// - "DONE" / status text → kept verbatim (uppercased, trimmed)
// - Other strings → trimmed
// - Empty / null → null
function cellText(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o["result"] instanceof Date) return (o["result"] as Date).toISOString().slice(0, 10);
    if ("result" in o) return cellText(o["result"]);
    if ("text" in o) return cellText(o["text"]);
    if ("richText" in o && Array.isArray(o["richText"])) {
      return cellText((o["richText"] as Array<{ text?: string }>).map((p) => p.text ?? "").join(""));
    }
    return null;
  }
  if (typeof v === "number") {
    if (v > 40000 && v < 60000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return d.toISOString().slice(0, 10);
    }
    return String(v);
  }
  const s = String(v).trim();
  if (!s) return null;
  // Indo date formats → normalize to ISO
  const m1 = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]!.padStart(2, "0")}-${m1[1]!.padStart(2, "0")}`;
  const m2 = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2]!.padStart(2, "0")}-${m2[3]!.padStart(2, "0")}`;
  return s;
}

function cellStr(v: unknown): string | null {
  return cellText(v);
}

function cellNum(v: unknown): string | null {
  const s = cellText(v);
  if (s == null) return null;
  const cleaned = s.replace(/[^\d.-]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return null;
  return cleaned;
}

function buildColMap(ws: ExcelJS.Worksheet, headerRow: number): Record<string, number> {
  const map: Record<string, number> = {};
  ws.getRow(headerRow).eachCell((cell, col) => {
    const raw = cellText(cell.value);
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

export async function syncOmpang(opts: { force?: boolean } = {}): Promise<SyncOmpangResult> {
  const t0 = Date.now();
  const filePath = env.SP_OMPANG_FILE;
  const sheetName = env.SP_OMPANG_SHEET;

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
      return { skipped: true, reason: "no_change", total: 0, inserted: 0, updated: 0, failed: 0, duration_ms: Date.now() - t0 };
    }
  }

  const buf = await spDownloadFile(filePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    const available = wb.worksheets.map((w) => w.name).join(", ");
    throw new Error(`Sheet "${sheetName}" not found. Available: ${available}`);
  }

  const map = buildColMap(ws, HEADER_ROW);

  const c = {
    tglDo:                 pick(map, "TANGGAL DO", "TGL DO"),
    namaStnk:              pick(map, "NAMA STNK", "NAMA KONSUMEN"),
    tipeMobil:             pick(map, "TIPE MOBIL", "TYPE"),
    warna:                 pick(map, "WARNA"),
    vin:                   pick(map, "NOMOR VIN", "VIN"),
    noMesin:               pick(map, "NOMOR MESIN", "NO MESIN"),
    payment:               pick(map, "PAYMENT"),
    domisili:              pick(map, "DOMISILI"),
    tglPengajuanOmpang:    pick(map, "TGL PENGAJUAN OMPANG"),
    tglPenerimaanOmpang:   pick(map, "TGL PENERIMAAN OMPANG"),
    tglSerahTerimaOmpang:  pick(map, "TGL SERAH TERIMA OMPANG"),
    tglPengajuanFaktur:    pick(map, "TGL PENGAJUAN FAKTUR"),
    tglPenerimaanFaktur:   pick(map, "TGL PENERIMAAN FAKTUR"),
    statusFaktur:          pick(map, "STATUS FAKTUR"),
    tglPengajuanStnkBpkb:  pick(map, "TGL PENGAJUAN STNK-BPKB", "TGL PENGAJUAN STNK BPKB"),
    noSuratPengajuan:      pick(map, "NO SURAT PENGAJUAN STNK-BPKB", "NO SURAT PENGAJUAN STNK BPKB"),
    tglPenerimaanStnk:     pick(map, "TGL PENERIMAAN STNK"),
    noSuratPenerimaanStnk: pick(map, "NO SURAT PENERIMAAN STNK"),
    tglSerahTerimaStnk:    pick(map, "TGL SERAH TERIMA STNK KE CABANG / SALES", "TGL SERAH TERIMA STNK"),
    noSuratSerahStnk:      pick(map, "NO SURAT SERAH TERIMA STNK KE CABANG / SALES", "NO SURAT SERAH TERIMA STNK"),
    tglPenerimaanBpkbBiro: pick(map, "TGL PENERIMAAN BPKB DARI BIRO"),
    tglSerahTerimaBpkb:    pick(map, "TGL SERAH TERIMA BPKB KE CABANG / SALES", "TGL SERAH TERIMA BPKB"),
    noSuratSerahBpkb:      pick(map, "NO SURAT SERAH TERIMA BPKB KE CABANG / SALES", "NO SURAT SERAH TERIMA BPKB"),
    noInvoice:             pick(map, "NO INVOICE"),
    nominalPayment:        pick(map, "NOMINAL PAYMENT"),
    pembayaran:            pick(map, "PEMBAYARAN"),
    rekening:              pick(map, "REKENING"),
    notes:                 pick(map, "NOTES", "CATATAN"),
  };

  const missing = Object.entries(c).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length > 0) {
    logger.warn({ missing }, "sync.ompang.missing_columns");
  }

  type Insert = typeof ompangTracking.$inferInsert;
  const rows: Insert[] = [];

  const cv = (row: ExcelJS.Row, col: number | null): unknown => (col ? row.getCell(col).value : null);

  ws.eachRow((row, n) => {
    if (n <= HEADER_ROW) return;
    const vin = cellStr(cv(row, c.vin))?.toUpperCase() ?? null;
    const nama = cellStr(cv(row, c.namaStnk));
    if (!vin && !nama) return;

    const raw: Record<string, string | null> = {};
    for (const [k, col] of Object.entries(c)) {
      raw[k] = col ? cellText(cv(row, col)) : null;
    }

    rows.push({
      vin: vin && vin.length === 17 ? vin : null,
      noMesin:               cellStr(cv(row, c.noMesin)),
      namaStnk:              nama,
      tipeMobil:             cellStr(cv(row, c.tipeMobil)),
      warna:                 cellStr(cv(row, c.warna)),
      payment:               cellStr(cv(row, c.payment)),
      domisili:              cellStr(cv(row, c.domisili)),
      tglDo:                 cellText(cv(row, c.tglDo)),
      tglPengajuanOmpang:    cellText(cv(row, c.tglPengajuanOmpang)),
      tglPenerimaanOmpang:   cellText(cv(row, c.tglPenerimaanOmpang)),
      tglSerahTerimaOmpang:  cellText(cv(row, c.tglSerahTerimaOmpang)),
      tglPengajuanFaktur:    cellText(cv(row, c.tglPengajuanFaktur)),
      tglPenerimaanFaktur:   cellText(cv(row, c.tglPenerimaanFaktur)),
      statusFaktur:          cellStr(cv(row, c.statusFaktur)),
      tglPengajuanStnkBpkb:  cellText(cv(row, c.tglPengajuanStnkBpkb)),
      noSuratPengajuan:      cellStr(cv(row, c.noSuratPengajuan)),
      tglPenerimaanStnk:     cellText(cv(row, c.tglPenerimaanStnk)),
      noSuratPenerimaanStnk: cellStr(cv(row, c.noSuratPenerimaanStnk)),
      tglSerahTerimaStnk:    cellText(cv(row, c.tglSerahTerimaStnk)),
      noSuratSerahStnk:      cellStr(cv(row, c.noSuratSerahStnk)),
      tglPenerimaanBpkbBiro: cellText(cv(row, c.tglPenerimaanBpkbBiro)),
      tglSerahTerimaBpkb:    cellText(cv(row, c.tglSerahTerimaBpkb)),
      noSuratSerahBpkb:      cellStr(cv(row, c.noSuratSerahBpkb)),
      noInvoice:             cellStr(cv(row, c.noInvoice)),
      nominalPayment:        cellNum(cv(row, c.nominalPayment)),
      pembayaran:            cellStr(cv(row, c.pembayaran)),
      rekening:              cellStr(cv(row, c.rekening)),
      notes:                 cellStr(cv(row, c.notes)),
      rawRow: raw,
      lastSynced: new Date(),
    });
  });

  logger.info({ parsed: rows.length, file: filePath }, "sync.ompang.parsed");

  // Existing VINs for upsert decision
  const existing = await db.select({ vin: ompangTracking.vin }).from(ompangTracking);
  const existingVins = new Set(existing.map((r) => r.vin).filter(Boolean) as string[]);

  let inserted = 0, updated = 0, failed = 0;
  for (const row of rows) {
    try {
      if (row.vin && existingVins.has(row.vin)) {
        await db.update(ompangTracking).set(row).where(eq(ompangTracking.vin, row.vin));
        updated++;
      } else if (row.vin) {
        await db.insert(ompangTracking).values(row);
        inserted++;
        existingVins.add(row.vin);
      } else {
        // No VIN: insert as-is. Can't upsert without natural key; tolerate duplicates.
        await db.insert(ompangTracking).values(row);
        inserted++;
      }
    } catch (err) {
      failed++;
      logger.warn({ vin: row.vin, nama: row.namaStnk, err: (err as Error).message }, "sync.ompang.row_failed");
    }
  }

  // Derive dealer dari do_log via VIN match (Jurnal Ompang sheet tidak punya kolom dealer).
  // Normalisasi `dealer_sj` (mis. "VINFAST SOEKARNO HATTA") ke enum SETIABUDI/PASTEUR/LASWI/SOETA/OMA.
  const dealerUpdate = await db.execute(sql`
    UPDATE ompang_tracking ot SET dealer = sub.dealer_norm
    FROM (
      SELECT dl.vin,
        CASE
          WHEN dl.dealer_sj ILIKE '%setiabudi%'                                THEN 'SETIABUDI'
          WHEN dl.dealer_sj ILIKE '%pasteur%'                                  THEN 'PASTEUR'
          WHEN dl.dealer_sj ILIKE '%laswi%'                                    THEN 'LASWI'
          WHEN dl.dealer_sj ILIKE '%soekarno%' OR dl.dealer_sj ILIKE '%soetta%' THEN 'SOETA'
          WHEN dl.dealer_sj ILIKE '%oma%'                                      THEN 'OMA'
          ELSE NULL
        END AS dealer_norm
      FROM do_log dl
    ) sub
    WHERE ot.vin = sub.vin AND sub.dealer_norm IS NOT NULL
  `);
  logger.info({ dealer_filled: dealerUpdate.rowCount ?? 0 }, "sync.ompang.dealer_derived");

  await redis.set(ETAG_KEY, meta.TimeLastModified);

  const result: SyncOmpangResult = {
    skipped: false,
    total: rows.length,
    inserted,
    updated,
    failed,
    duration_ms: Date.now() - t0,
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
