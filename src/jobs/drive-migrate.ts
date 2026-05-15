import { stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { lookup as mimeLookup } from "mime-types";
import { env } from "../config/env.js";
import { readAllRows, updateRowByNumber } from "../services/sheets.js";
import { driveUpload } from "../services/drive.js";
import { logger } from "../services/logger.js";

export interface MigrateResult {
  scanned: number;
  uploaded: number;
  skipped_already_uploaded: number;
  skipped_missing_file: number;
  failed: number;
  errors: { no_spk: string; field: string; err: string }[];
  duration_ms: number;
}

// path column → gdrive_id/link columns mapping
const FOTO_FIELDS = [
  { pathCol: "foto_ktp_pembeli", idCol: "gdrive_id_ktp_pembeli", linkCol: "gdrive_link_ktp_pembeli", label: "ktp_pembeli" },
  { pathCol: "foto_ktp_stnk",    idCol: "gdrive_id_ktp_stnk",    linkCol: "gdrive_link_ktp_stnk",    label: "ktp_stnk"    },
  { pathCol: "foto_tf",          idCol: "gdrive_id_tf",          linkCol: "gdrive_link_tf",          label: "tf"          },
] as const;

export async function migrateDriveFromLeadsSpk(
  opts: { limit?: number; dryRun?: boolean } = {}
): Promise<MigrateResult> {
  const t0 = Date.now();
  const result: MigrateResult = {
    scanned: 0,
    uploaded: 0,
    skipped_already_uploaded: 0,
    skipped_missing_file: 0,
    failed: 0,
    errors: [],
    duration_ms: 0,
  };

  const { headers, rows, rowNumbers } = await readAllRows("Leads_SPK");
  if (rows.length === 0) { result.duration_ms = Date.now() - t0; return result; }

  const colIdx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iNoSpk = colIdx("no_spk_temp");

  let processed = 0;
  for (let i = 0; i < rows.length; i++) {
    if (opts.limit && processed >= opts.limit) break;

    const row = rows[i] ?? [];
    const rowNumber = rowNumbers[i];
    if (!rowNumber) continue;

    const noSpk = String(iNoSpk >= 0 ? (row[iNoSpk] ?? "") : "").trim();
    if (!noSpk) continue;

    const updates: Record<string, string> = {};

    for (const field of FOTO_FIELDS) {
      result.scanned++;
      const iPath = colIdx(field.pathCol);
      const iId   = colIdx(field.idCol);
      if (iPath < 0) continue;

      const relPath = String(row[iPath] ?? "").trim();
      if (!relPath) continue;

      const existingId = iId >= 0 ? String(row[iId] ?? "").trim() : "";
      if (existingId) { result.skipped_already_uploaded++; continue; }

      const absPath = join(env.UPLOADS_DIR, relPath);
      try {
        await stat(absPath);
      } catch {
        result.skipped_missing_file++;
        logger.warn({ no_spk: noSpk, field: field.pathCol, relPath }, "drive.migrate.missing_file");
        continue;
      }

      if (opts.dryRun) {
        logger.info({ no_spk: noSpk, field: field.pathCol, relPath }, "drive.migrate.dryrun");
        continue;
      }

      try {
        const yyyymm = extractYyyyMm(noSpk);
        const mime = mimeLookup(absPath) || "application/octet-stream";
        const up = await driveUpload(absPath, {
          subfolder: noSpk,
          yyyymm,
          mimeType: mime,
          filename: `${field.label}_${Date.now()}${extname(absPath)}`,
        });
        updates[field.idCol]   = up.fileId;
        updates[field.linkCol] = up.webViewLink;
        result.uploaded++;
      } catch (err) {
        result.failed++;
        result.errors.push({ no_spk: noSpk, field: field.pathCol, err: (err as Error).message });
        logger.error({ no_spk: noSpk, field: field.pathCol, err: (err as Error).message }, "drive.migrate.upload_failed");
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        await updateRowByNumber("Leads_SPK", rowNumber, updates);
      } catch (err) {
        logger.error({ no_spk: noSpk, err: (err as Error).message }, "drive.migrate.sheet_update_failed");
      }
    }

    processed++;
  }

  result.duration_ms = Date.now() - t0;
  logger.info(result, "drive.migrate.done");
  return result;
}

function extractYyyyMm(noSpk: string): string {
  const m = noSpk.match(/SPK-DRAFT-(\d{4})-(\d{2})-/i);
  if (m) return `${m[1]}-${m[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
