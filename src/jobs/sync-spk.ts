import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { spkLeads, syncState } from "../db/schema.js";
import { readAllRows } from "../services/sheets.js";
import { logger } from "../services/logger.js";

const JOB_NAME = "sync_spk_leads";

export interface SyncSpkResult {
  total_sheet: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  duration_ms: number;
}

export async function syncSpkLeads(): Promise<SyncSpkResult> {
  const t0 = Date.now();

  const { headers, rows, rowNumbers } = await readAllRows("Leads_SPK");
  if (rows.length === 0) {
    const result = { total_sheet: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0, duration_ms: Date.now() - t0 };
    await recordRun(result);
    return result;
  }

  const colIdx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const idx = {
    no_spk_temp:       colIdx("no_spk_temp"),
    nama_pembeli:      colIdx("nama_pembeli"),
    nik_pembeli:       colIdx("nik_pembeli"),
    tgl_lahir_pembeli: colIdx("tgl_lahir_pembeli"),
    alamat_pembeli:    colIdx("alamat_pembeli"),
    sales_wa:          colIdx("sales_wa"),
    sales_nama:        colIdx("sales_nama"),
    dealer:            colIdx("dealer"),
    tipe_mobil:        colIdx("tipe_mobil"),
    warna:             colIdx("warna"),
    tipe_baterai:      colIdx("tipe_baterai"),
    status_lengkap:    colIdx("status_lengkap"),
    foto_ktp_pembeli:  colIdx("foto_ktp_pembeli"),
    foto_ktp_stnk:     colIdx("foto_ktp_stnk"),
    foto_tf:           colIdx("foto_tf"),
    tf_bank:           colIdx("tf_bank"),
    tf_nominal:        colIdx("tf_nominal"),
    tf_berita:         colIdx("tf_berita"),
    tf_referensi:      colIdx("tf_referensi"),
    notes:             colIdx("notes"),
  };

  if (idx.no_spk_temp < 0) {
    throw new Error(`Column "no_spk_temp" tidak ditemukan di Leads_SPK. Headers: ${headers.join(", ")}`);
  }

  // Load existing hash map untuk incremental diff
  const existing = await db.select({ noSpkTemp: spkLeads.noSpkTemp, rowHash: spkLeads.rowHash }).from(spkLeads);
  const existingMap = new Map(existing.map((e) => [e.noSpkTemp, e.rowHash]));

  let inserted = 0, updated = 0, unchanged = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = rowNumbers[i] ?? 0;
    const get = (col: number): string => (col >= 0 ? String(row[col] ?? "").trim() : "");

    const noSpk = get(idx.no_spk_temp);
    if (!noSpk) continue;

    const raw: Record<string, string> = {};
    headers.forEach((h, c) => { raw[h] = String(row[c] ?? ""); });

    const hash = createHash("sha1").update(JSON.stringify(raw)).digest("hex");
    const prevHash = existingMap.get(noSpk);
    if (prevHash === hash) { unchanged++; continue; }

    const values = {
      noSpkTemp:       noSpk,
      sheetRowNumber:  rowNumber,
      rowHash:         hash,
      namaPembeli:     get(idx.nama_pembeli) || null,
      nikPembeli:      get(idx.nik_pembeli) || null,
      tglLahirPembeli: get(idx.tgl_lahir_pembeli) || null,
      alamatPembeli:   get(idx.alamat_pembeli) || null,
      salesWa:         get(idx.sales_wa) || null,
      salesNama:       get(idx.sales_nama) || null,
      dealer:          get(idx.dealer) || null,
      tipeMobil:       get(idx.tipe_mobil) || null,
      warna:           get(idx.warna) || null,
      tipeBaterai:     get(idx.tipe_baterai) || null,
      statusLengkap:   get(idx.status_lengkap) || null,
      fotoKtpPembeli:  get(idx.foto_ktp_pembeli) || null,
      fotoKtpStnk:     get(idx.foto_ktp_stnk) || null,
      fotoTf:          get(idx.foto_tf) || null,
      tfBank:          get(idx.tf_bank) || null,
      tfNominal:       get(idx.tf_nominal) || null,
      tfBerita:        get(idx.tf_berita) || null,
      tfReferensi:     get(idx.tf_referensi) || null,
      notes:           get(idx.notes) || null,
      rawRow:          raw,
      syncedAt:        new Date(),
      updatedAt:       new Date(),
    };

    try {
      if (!prevHash) {
        await db.insert(spkLeads).values(values);
        inserted++;
      } else {
        await db.update(spkLeads).set(values).where(eq(spkLeads.noSpkTemp, noSpk));
        updated++;
      }
    } catch (err) {
      failed++;
      logger.warn({ no_spk_temp: noSpk, err: (err as Error).message }, "sync.spk.row_failed");
    }
  }

  const result: SyncSpkResult = { total_sheet: rows.length, inserted, updated, unchanged, failed, duration_ms: Date.now() - t0 };
  await recordRun(result);
  logger.info(result, "sync.spk.done");
  return result;
}

async function recordRun(result: SyncSpkResult): Promise<void> {
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
