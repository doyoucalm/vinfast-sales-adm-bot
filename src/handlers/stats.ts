import { sql, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { ompangTracking, stok, spk, doLog } from "../db/schema.js";
import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";

// /stats — counter ringkasan semua kategori
const CMD_RE = /^\/?stats?(?:\s|$)/i;

export function isStatsCommand(text: string): boolean {
  return CMD_RE.test(text.trim());
}

export async function handleStatsCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;

  const role = ctx.karyawan.role;
  const dealerFilter = role === "manager" && ctx.karyawan.dealer ? ctx.karyawan.dealer : null;

  const scopeLabel = dealerFilter ?? "Semua Dealer";

  // SPK
  const spkCond = dealerFilter ? sql`AND dealer = ${dealerFilter}` : sql``;
  const spkStats = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE no_spk IS NOT NULL) AS with_no_spk,
      COUNT(*) FILTER (WHERE payment_type ILIKE '%cash%' OR payment_type ILIKE '%tunai%') AS cash,
      COUNT(*) FILTER (WHERE payment_type ILIKE '%kredit%') AS kredit
    FROM spk WHERE 1=1 ${spkCond}
  `);

  // Stok
  const stokLokasiCond = dealerFilter ? sql`AND lokasi ILIKE ${`%${dealerFilter}%`}` : sql``;
  const stokStats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'READY')      AS ready,
      COUNT(*) FILTER (WHERE status = 'SOLD')       AS sold,
      ROUND(AVG(umur_hari) FILTER (WHERE status = 'READY')::numeric, 0) AS avg_umur_ready
    FROM stok WHERE 1=1 ${stokLokasiCond}
  `);

  // Ompang/Faktur/STNK 3-state
  const omCond = dealerFilter ? sql`AND dealer = ${dealerFilter}` : sql``;
  const omStats = await db.execute(sql`
    SELECT
      -- Ompang
      COUNT(*) FILTER (WHERE tgl_pengajuan_ompang IS NOT NULL AND tgl_penerimaan_ompang IS NULL)     AS omp_diajukan,
      COUNT(*) FILTER (WHERE tgl_penerimaan_ompang IS NOT NULL AND tgl_serah_terima_ompang IS NULL)  AS omp_ready,
      COUNT(*) FILTER (WHERE tgl_serah_terima_ompang IS NOT NULL)                                    AS omp_done,
      -- Faktur
      COUNT(*) FILTER (WHERE tgl_pengajuan_faktur IS NOT NULL AND tgl_penerimaan_faktur IS NULL)     AS fak_diajukan,
      COUNT(*) FILTER (WHERE tgl_penerimaan_faktur IS NOT NULL AND status_faktur IS DISTINCT FROM 'DONE') AS fak_ready,
      COUNT(*) FILTER (WHERE status_faktur = 'DONE')                                                 AS fak_done,
      -- STNK
      COUNT(*) FILTER (WHERE tgl_pengajuan_stnk_bpkb IS NOT NULL AND tgl_penerimaan_stnk IS NULL)    AS stnk_diajukan,
      COUNT(*) FILTER (WHERE tgl_penerimaan_stnk IS NOT NULL AND tgl_serah_terima_stnk IS NULL)      AS stnk_ready,
      COUNT(*) FILTER (WHERE tgl_serah_terima_stnk IS NOT NULL)                                      AS stnk_done,
      COUNT(*) AS unit_total
    FROM ompang_tracking WHERE 1=1 ${omCond}
  `);

  // DO
  const doCond = dealerFilter ? sql`AND dealer_sj ILIKE ${`%${dealerFilter}%`}` : sql``;
  const doStats = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      MAX(tgl_do) AS latest,
      COUNT(*) FILTER (WHERE tgl_do >= CURRENT_DATE - INTERVAL '7 days') AS last_7d,
      COUNT(*) FILTER (WHERE tgl_do >= CURRENT_DATE - INTERVAL '30 days') AS last_30d
    FROM do_log WHERE 1=1 ${doCond}
  `);

  const n = (v: unknown) => (v == null ? 0 : Number(v));
  const s = (v: unknown) => (v == null ? "-" : String(v));
  const ss = spkStats.rows[0]  as Record<string, unknown>;
  const st = stokStats.rows[0] as Record<string, unknown>;
  const om = omStats.rows[0]   as Record<string, unknown>;
  const ds = doStats.rows[0]   as Record<string, unknown>;

  const lines: string[] = [];
  lines.push(`📊 *Stats VinFast* — ${scopeLabel}`);
  lines.push("");
  lines.push(`*SPK Master*`);
  lines.push(`  Total: ${n(ss.total)} | Punya No SPK: ${n(ss.with_no_spk)}`);
  lines.push(`  Cash: ${n(ss.cash)} | Kredit: ${n(ss.kredit)}`);
  lines.push("");
  lines.push(`*Stok*`);
  lines.push(`  Ready: ${n(st.ready)} unit | Sold: ${n(st.sold)}`);
  lines.push(`  Avg umur ready: ${n(st.avg_umur_ready)} hari`);
  lines.push("");
  lines.push(`*Ompang* (total tracking: ${n(om.unit_total)})`);
  lines.push(`  Diajukan: ${n(om.omp_diajukan)} | Ready: ${n(om.omp_ready)} | Done: ${n(om.omp_done)}`);
  lines.push("");
  lines.push(`*Faktur*`);
  lines.push(`  Diajukan: ${n(om.fak_diajukan)} | Ready: ${n(om.fak_ready)} | Done: ${n(om.fak_done)}`);
  lines.push("");
  lines.push(`*STNK*`);
  lines.push(`  Diajukan: ${n(om.stnk_diajukan)} | Ready: ${n(om.stnk_ready)} | Done: ${n(om.stnk_done)}`);
  lines.push("");
  lines.push(`*DO*`);
  lines.push(`  Total: ${n(ds.total)} | 7d: ${n(ds.last_7d)} | 30d: ${n(ds.last_30d)}`);
  lines.push(`  DO terakhir: ${s(ds.latest)}`);
  lines.push("");
  lines.push(`_Detail: /stnk /ompang /faktur /do /status <nama|VIN>_`);

  // Avoid unused-import errors for tables we only reference via raw SQL
  void ompangTracking; void stok; void spk; void doLog; void eq;

  await evolution.sendText(ctx.msg.fromNumber, lines.join("\n"), { delayMs: 500 });
}
