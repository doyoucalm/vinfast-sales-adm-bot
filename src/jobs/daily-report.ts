import { gte, lt, and, eq, isNull, isNotNull, count, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { spkLeads, ompangTracking, stok, karyawan } from "../db/schema.js";
import { evolution } from "../services/evolution.js";
import { logger } from "../services/logger.js";
import { env } from "../config/env.js";

// 08:00 WIB = 01:00 UTC
const REPORT_HOUR_UTC = 1;

interface DealerStats {
  dealer: string | null;
  spkBaru: number;
  stokReady: number;
  stnkPending: number;
  fakturPending: number;
  ompangPending: number;
}

async function buildReport(dealerFilter: string | null, date: Date): Promise<DealerStats[]> {
  // H-1: from midnight-1 00:00 UTC to today 00:00 UTC (approximate WIB day)
  const todayUtc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const yesterdayUtc = new Date(todayUtc.getTime() - 86400 * 1000);

  // SPK baru kemarin
  const spkQuery = db
    .select({
      dealer: spkLeads.dealer,
      spkBaru: count(spkLeads.id),
    })
    .from(spkLeads)
    .where(
      and(
        gte(spkLeads.createdAt, yesterdayUtc),
        lt(spkLeads.createdAt, todayUtc),
        dealerFilter ? eq(spkLeads.dealer, dealerFilter) : undefined
      )
    )
    .groupBy(spkLeads.dealer);

  // Stok ready per dealer
  const stokQuery = db
    .select({
      dealer: stok.lokasi,
      stokReady: count(stok.id),
    })
    .from(stok)
    .where(
      and(
        eq(stok.status, "READY"),
        dealerFilter ? eq(stok.lokasi, dealerFilter) : undefined
      )
    )
    .groupBy(stok.lokasi);

  // Dokumen pending (tanggal serah masih null = belum selesai)
  const stnkPendingQ = db
    .select({ cnt: count(ompangTracking.id) })
    .from(ompangTracking)
    .where(isNull(ompangTracking.tglSerahTerimaStnk));

  const fakturPendingQ = db
    .select({ cnt: count(ompangTracking.id) })
    .from(ompangTracking)
    .where(isNull(ompangTracking.tglPenerimaanFaktur));

  const ompangPendingQ = db
    .select({ cnt: count(ompangTracking.id) })
    .from(ompangTracking)
    .where(isNull(ompangTracking.tglSerahTerimaOmpang));

  const [spkRows, stokRows, [stnkPending], [fakturPending], [ompangPending]] = await Promise.all([
    spkQuery, stokQuery, stnkPendingQ, fakturPendingQ, ompangPendingQ,
  ]);

  // Merge by dealer
  const dealers = new Set<string | null>();
  spkRows.forEach((r) => dealers.add(r.dealer));
  stokRows.forEach((r) => dealers.add(r.dealer));
  if (dealers.size === 0) dealers.add(dealerFilter);

  const spkMap  = new Map(spkRows.map((r) => [r.dealer, r.spkBaru]));
  const stokMap = new Map(stokRows.map((r) => [r.dealer, r.stokReady]));

  const results: DealerStats[] = [];
  for (const dealer of dealers) {
    results.push({
      dealer,
      spkBaru:       spkMap.get(dealer)  ?? 0,
      stokReady:     stokMap.get(dealer) ?? 0,
      stnkPending:   stnkPending?.cnt  ?? 0,
      fakturPending: fakturPending?.cnt ?? 0,
      ompangPending: ompangPending?.cnt ?? 0,
    });
  }

  return results;
}

function formatReport(stats: DealerStats[], date: Date, forDealer: string | null): string {
  const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  const ymd = new Date(date.getTime() - 86400 * 1000);
  const tgl = `${ymd.getUTCDate()} ${BULAN[ymd.getUTCMonth()]} ${ymd.getUTCFullYear()}`;

  const lines: string[] = [];
  lines.push(`📊 *Laporan Harian VinFast*`);
  lines.push(`Tanggal: ${tgl} | ${forDealer ?? "Semua Dealer"}`);
  lines.push("");

  const totalSpk   = stats.reduce((a, s) => a + s.spkBaru, 0);
  const totalStok  = stats.reduce((a, s) => a + s.stokReady, 0);
  const totalStnk  = stats[0]?.stnkPending ?? 0;
  const totalFaktur = stats[0]?.fakturPending ?? 0;
  const totalOmpang = stats[0]?.ompangPending ?? 0;

  lines.push(`*SPK Baru Kemarin*: ${totalSpk}`);
  if (!forDealer && stats.length > 1) {
    for (const s of stats.filter((x) => x.spkBaru > 0)) {
      lines.push(`  • ${s.dealer ?? "-"}: ${s.spkBaru}`);
    }
  }
  lines.push("");

  lines.push(`*Stok Unit Ready*: ${totalStok}`);
  if (!forDealer && stats.length > 1) {
    for (const s of stats.filter((x) => x.stokReady > 0)) {
      lines.push(`  • ${s.dealer ?? "-"}: ${s.stokReady}`);
    }
  }
  lines.push("");

  lines.push(`*Dokumen Pending*`);
  lines.push(`  • Ompang  : ${totalOmpang} berkas`);
  lines.push(`  • Faktur  : ${totalFaktur} berkas`);
  lines.push(`  • STNK    : ${totalStnk} berkas`);

  return lines.join("\n");
}

export async function sendDailyReport(): Promise<void> {
  if (!env.DAILY_REPORT_ENABLED) return;

  const now = new Date();
  logger.info("daily_report.start");

  try {
    // Owner / Admin: send full report
    const fullStats = await buildReport(null, now);
    const fullMsg   = formatReport(fullStats, now, null);

    // Get owner + admin recipients
    const owners = await db
      .select({ noWa: karyawan.noWa, nama: karyawan.nama, dealer: karyawan.dealer })
      .from(karyawan)
      .where(
        and(
          eq(karyawan.active, true),
          sql`${karyawan.role} IN ('owner','admin')`
        )
      );

    for (const o of owners) {
      try {
        await evolution.sendText(o.noWa, fullMsg, { delayMs: 800 });
      } catch (err) {
        logger.warn({ noWa: o.noWa, err: (err as Error).message }, "daily_report.owner_send_failed");
      }
    }

    // Manager (BM): send dealer-specific report
    const managers = await db
      .select({ noWa: karyawan.noWa, nama: karyawan.nama, dealer: karyawan.dealer })
      .from(karyawan)
      .where(
        and(
          eq(karyawan.active, true),
          eq(karyawan.role, "manager")
        )
      );

    for (const bm of managers) {
      if (!bm.dealer) continue;
      try {
        const bmStats = await buildReport(bm.dealer, now);
        const bmMsg   = formatReport(bmStats, now, bm.dealer);
        await evolution.sendText(bm.noWa, bmMsg, { delayMs: 800 });
      } catch (err) {
        logger.warn({ noWa: bm.noWa, dealer: bm.dealer, err: (err as Error).message }, "daily_report.bm_send_failed");
      }
    }

    logger.info({ owners: owners.length, managers: managers.length }, "daily_report.done");
  } catch (err) {
    logger.error({ err: (err as Error).message, stack: (err as Error).stack }, "daily_report.failed");
  }
}

// Schedule next 08:00 WIB (01:00 UTC) using recursive setTimeout
export function scheduleDailyReport(): void {
  const msUntilNext = (): number => {
    const now = new Date();
    const next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      REPORT_HOUR_UTC, 0, 0, 0
    ));
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  };

  const schedule = (): void => {
    const ms = msUntilNext();
    logger.info({ nextInMs: ms, nextIn: `${Math.round(ms / 60000)}min` }, "daily_report.scheduled");
    setTimeout(async () => {
      await sendDailyReport();
      schedule(); // reschedule for next day
    }, ms).unref();
  };

  schedule();
}
