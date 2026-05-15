import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { karyawan } from "../db/schema.js";
import {
  normalizeNoWa, normalizeJabatan, normalizeNama, normalizeAktif, parseDateID,
} from "../utils/normalizers.js";
import { logger } from "./logger.js";

export type KaryawanInput = {
  nama: string;
  no_wa: string;
  jabatan?: string | null;
  tgl_join?: string | null;
  active?: boolean | string;
  email?: string | null;
  dealer?: string | null;
  source?: string;
  raw_row?: unknown;
  force_role?: string;
};

export type KaryawanRow = typeof karyawan.$inferSelect;

/**
 * Lookup karyawan aktif by WA number — used by WA auth middleware
 */
export async function findActiveKaryawanByWa(noWaRaw: string): Promise<KaryawanRow | null> {
  const noWa = normalizeNoWa(noWaRaw);
  if (!noWa) return null;

  const rows = await db
    .select()
    .from(karyawan)
    .where(and(eq(karyawan.noWa, noWa), eq(karyawan.active, true)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Upsert karyawan
 */
export async function upsertKaryawan(input: KaryawanInput): Promise<{ created: boolean; row: KaryawanRow }> {
  const noWa = normalizeNoWa(input.no_wa);
  if (!noWa) throw new Error(`Invalid no_wa: ${input.no_wa}`);

  const nama = normalizeNama(input.nama);
  if (!nama) throw new Error("nama required");

  const j = normalizeJabatan(input.jabatan);
  const role = input.force_role ?? j.role;
  const active = typeof input.active === "boolean" ? input.active : normalizeAktif(input.active);
  const tglJoin = typeof input.tgl_join === "string" ? parseDateID(input.tgl_join) : null;

  const existing = await db.select().from(karyawan).where(eq(karyawan.noWa, noWa)).limit(1);

  if (existing.length > 0) {
    const cur = existing[0]!;
    const updated = await db
      .update(karyawan)
      .set({
        nama,
        jabatan: j.jabatan,
        jabatanRaw: input.jabatan ?? null,
        role,
        dealer: input.dealer ?? cur.dealer,
        tglJoin: tglJoin ? tglJoin.toISOString().slice(0, 10) : cur.tglJoin,
        active,
        email: input.email ?? cur.email,
        source: input.source ?? cur.source,
        rawRow: input.raw_row ?? cur.rawRow,
        lastSyncedAt: input.source && input.source !== "MANUAL" ? new Date() : cur.lastSyncedAt,
        updatedAt: new Date(),
      })
      .where(eq(karyawan.noWa, noWa))
      .returning();

    logger.debug({ noWa, nama, role }, "karyawan updated");
    return { created: false, row: updated[0]! };
  }

  const inserted = await db
    .insert(karyawan)
    .values({
      noWa,
      nama,
      jabatan: j.jabatan,
      jabatanRaw: input.jabatan ?? null,
      role,
      dealer: input.dealer ?? null,
      tglJoin: tglJoin ? tglJoin.toISOString().slice(0, 10) : null,
      active,
      email: input.email ?? null,
      source: input.source ?? "MANUAL",
      rawRow: input.raw_row ?? null,
      lastSyncedAt: input.source && input.source !== "MANUAL" ? new Date() : null,
    })
    .returning();

  logger.debug({ noWa, nama, role }, "karyawan inserted");
  return { created: true, row: inserted[0]! };
}

/**
 * List all karyawan
 */
export async function listKaryawan(opts: { activeOnly?: boolean; role?: string } = {}): Promise<KaryawanRow[]> {
  const conditions = [];
  if (opts.activeOnly) conditions.push(eq(karyawan.active, true));
  if (opts.role) conditions.push(eq(karyawan.role, opts.role));

  return db
    .select()
    .from(karyawan)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(karyawan.role, karyawan.nama);
}

/**
 * Stats by role
 */
export async function karyawanStats() {
  return db
    .select({
      role: karyawan.role,
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${karyawan.active} = true)::int`,
    })
    .from(karyawan)
    .groupBy(karyawan.role);
}

/**
 * Get first name for greeting
 */
export function getNamaPanggilan(k: KaryawanRow): string {
  const parts = k.nama.trim().split(" ");
  return parts[0] ?? k.nama;
}
