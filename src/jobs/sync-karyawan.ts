import ExcelJS from "exceljs";
import { eq, and, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { karyawan } from "../db/schema.js";
import { upsertKaryawan } from "../services/karyawan.js";
import { spDownloadFile, spGetFileMeta } from "../services/sharepoint.js";
import { normalizeNoWa } from "../utils/normalizers.js";
import { logger } from "../services/logger.js";
import { redis } from "../services/redis.js";
import { env } from "../config/env.js";

const ETAG_KEY = "sync:karyawan:last_modified";

type ExcelKaryawan = {
  nama: string;
  no_wa: string;
  jabatan: string;
  tgl_join: string;
  status: string;
  email?: string;
  dealer?: string;
  raw: Record<string, unknown>;
};

export interface SyncResult {
  skipped: boolean;
  reason?: string;
  total_excel: number;
  created: number;
  updated: number;
  deactivated: number;
  failed: number;
  errors: { no_wa: string; nama: string; err: string }[];
  duration_ms: number;
}

export async function syncKaryawan(opts: { force?: boolean } = {}): Promise<SyncResult> {
  const t0 = Date.now();
  const filePath = env.SP_KARYAWAN_FILE;
  const sheetName = env.SP_KARYAWAN_SHEET;

  // 1. Check if file changed before downloading
  let meta: { TimeLastModified: string; Length: string; Name: string };
  try {
    meta = await spGetFileMeta(filePath);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "sync.karyawan.meta_failed");
    return {
      skipped: true, reason: "meta_failed",
      total_excel: 0, created: 0, updated: 0, deactivated: 0, failed: 0, errors: [],
      duration_ms: Date.now() - t0,
    };
  }

  if (!opts.force) {
    const last = await redis.get(ETAG_KEY);
    if (last === meta.TimeLastModified) {
      logger.debug({ TimeLastModified: meta.TimeLastModified }, "sync.karyawan.no_change");
      return {
        skipped: true, reason: "no_change",
        total_excel: 0, created: 0, updated: 0, deactivated: 0, failed: 0, errors: [],
        duration_ms: Date.now() - t0,
      };
    }
  }

  // 2. Download + parse Excel
  const buf = await spDownloadFile(filePath);
  const rows = await parseExcel(buf, sheetName);
  logger.info({ count: rows.length, file: filePath }, "sync.karyawan.parsed");

  // 3. Upsert each row
  let created = 0, updated = 0, failed = 0;
  const errors: SyncResult["errors"] = [];
  const seenWa: string[] = [];

  for (const row of rows) {
    try {
      const normalized = normalizeNoWa(row.no_wa);
      if (!normalized) {
        failed++;
        errors.push({ no_wa: row.no_wa, nama: row.nama, err: "invalid_no_wa" });
        continue;
      }
      seenWa.push(normalized);

      const result = await upsertKaryawan({
        nama: row.nama,
        no_wa: row.no_wa,
        jabatan: row.jabatan,
        tgl_join: row.tgl_join,
        active: row.status,
        email: row.email,
        dealer: row.dealer,
        source: "SHAREPOINT_SYNC",
        raw_row: row.raw,
      });
      if (result.created) created++;
      else updated++;
    } catch (e) {
      failed++;
      errors.push({ no_wa: row.no_wa, nama: row.nama, err: (e as Error).message });
      logger.warn({ no_wa: row.no_wa, err: (e as Error).message }, "sync.karyawan.row_failed");
    }
  }

  // 4. Soft-deactivate SP_SYNC rows missing from this Excel run.
  //    Never touches MANUAL/SEED entries — admin accounts stay alive even if not in HR Excel.
  let deactivated = 0;
  if (seenWa.length > 0) {
    const deactivatedRows = await db
      .update(karyawan)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(karyawan.source, "SHAREPOINT_SYNC"),
          eq(karyawan.active, true),
          notInArray(karyawan.noWa, seenWa)
        )
      )
      .returning({ id: karyawan.id, noWa: karyawan.noWa, nama: karyawan.nama });

    deactivated = deactivatedRows.length;
    if (deactivated > 0) {
      logger.warn(
        { deactivated, names: deactivatedRows.map((r) => `${r.noWa}:${r.nama}`).join(", ") },
        "sync.karyawan.deactivated"
      );
    }
  }

  // 5. Cache TimeLastModified to skip unchanged Excel on next run
  await redis.set(ETAG_KEY, meta.TimeLastModified);

  const duration_ms = Date.now() - t0;
  logger.info({ total_excel: rows.length, created, updated, deactivated, failed, duration_ms }, "sync.karyawan.done");

  return { skipped: false, total_excel: rows.length, created, updated, deactivated, failed, errors, duration_ms };
}

// ─── Excel parser ─────────────────────────────────────────────────────────────

async function parseExcel(buf: Buffer, sheetName: string): Promise<ExcelKaryawan[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    throw new Error(
      `Sheet "${sheetName}" tidak ditemukan. Available: ${wb.worksheets.map((w) => w.name).join(", ")}`
    );
  }

  // Build column map from header row (row 1)
  const headerRow = ws.getRow(1);
  const colMap: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const raw = String(cell.value ?? "").trim().toLowerCase();
    if (raw) colMap[raw] = colNumber;
  });

  // Resolve column index from multiple possible header aliases (HR Excel loves renaming)
  const resolve = (aliases: string[]): number | null => {
    for (const a of aliases) {
      const idx = colMap[a.toLowerCase()];
      if (idx) return idx;
    }
    return null;
  };

  const cNama    = resolve(["nama", "nama karyawan", "name"]);
  const cNoWa    = resolve(["no_wa", "no wa", "nowa", "wa", "whatsapp", "no hp", "no_hp", "telp", "phone"]);
  const cJabatan = resolve(["jabatan", "position", "role"]);
  const cTglJoin = resolve(["tgl_join", "tgl join", "tanggal join", "join date", "tgl_masuk", "tgl masuk"]);
  const cStatus  = resolve(["status", "active", "aktif"]);
  const cEmail   = resolve(["email", "e-mail"]);
  const cDealer  = resolve(["dealer", "cabang", "branch"]);

  if (!cNama || !cNoWa || !cJabatan) {
    throw new Error(
      `Required columns missing. Found: ${Object.keys(colMap).join(", ")}. ` +
      `Need at least: nama, no_wa, jabatan.`
    );
  }

  const out: ExcelKaryawan[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const get = (col: number | null): string => {
      if (!col) return "";
      const v = row.getCell(col).value;
      if (v == null) return "";
      if (typeof v === "object" && v !== null) {
        if ("text" in v) return String((v as { text: unknown }).text ?? "").trim();
        if ("result" in v) return String((v as { result: unknown }).result ?? "").trim();
        if (v instanceof Date) return v.toLocaleDateString("id-ID");
      }
      return String(v).trim();
    };

    const nama = get(cNama);
    const no_wa = get(cNoWa);
    if (!nama || !no_wa) return; // skip empty rows

    const raw: Record<string, unknown> = {};
    headerRow.eachCell((cell, col) => {
      const key = String(cell.value ?? "").trim();
      if (key) raw[key] = row.getCell(col).value;
    });

    out.push({
      nama,
      no_wa,
      jabatan: get(cJabatan),
      tgl_join: get(cTglJoin),
      status: get(cStatus) || "aktif",
      email: get(cEmail) || undefined,
      dealer: get(cDealer) || undefined,
      raw,
    });
  });

  return out;
}
