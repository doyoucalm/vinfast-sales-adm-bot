import { logger } from "../services/logger.js";
import { syncKaryawan } from "./sync-karyawan.js";
import { syncSpkLeads } from "./sync-spk.js";
import { syncOmpang } from "./sync-ompang.js";
import { syncDo } from "./sync-do.js";
import { syncSpkMaster } from "./sync-spk-master.js";
import { syncStok } from "./sync-stok.js";
import { scheduleDailyReport } from "./daily-report.js";
import { env } from "../config/env.js";

const HOUR = 60 * 60_000;
const DAY  = 24 * HOUR;

interface JobConfig {
  name: string;
  intervalMs: number;
  fn: () => Promise<unknown>;
}

// Karyawan: cek harian, tapi syncKaryawan skip via etag kalau Excel tidak berubah.
// Efektif monthly karena HR jarang update file, tapi tetap catch perubahan dalam 24h.
// (Node.js timer max ~24.8 hari, jadi 30-day setInterval tidak safe.)
const jobs: JobConfig[] = [
  {
    name: "sync_karyawan",
    intervalMs: env.SP_KARYAWAN_SYNC_INTERVAL_MS,
    fn: () => syncKaryawan(),
  },
  {
    name: "sync_spk_leads",
    intervalMs: env.SYNC_SPK_INTERVAL_MS,
    fn: () => syncSpkLeads(),
  },
  {
    name: "sync_ompang",
    intervalMs: env.SYNC_OMPANG_INTERVAL_MS,
    fn: () => syncOmpang(),
  },
  {
    name: "sync_do",
    intervalMs: env.SYNC_DO_INTERVAL_MS,
    fn: () => syncDo(),
  },
  {
    name: "sync_spk_master",
    intervalMs: env.SYNC_SPK_MASTER_INTERVAL_MS,
    fn: () => syncSpkMaster(),
  },
  {
    name: "sync_stok",
    intervalMs: env.SYNC_STOK_INTERVAL_MS,
    fn: () => syncStok(),
  },
];

const handles: NodeJS.Timeout[] = [];

export function startScheduler(): void {
  for (const job of jobs) {
    // Run once on boot after 30s warmup delay, then on fixed interval
    setTimeout(() => runJob(job), 30_000);
    const h = setInterval(() => runJob(job), job.intervalMs);
    h.unref();
    handles.push(h);
    logger.info({ job: job.name, intervalMs: job.intervalMs }, "scheduler.started");
  }

  // Daily report at 08:00 WIB (01:00 UTC)
  scheduleDailyReport();
}

export function stopScheduler(): void {
  for (const h of handles) clearInterval(h);
  handles.length = 0;
  logger.info("scheduler.stopped");
}

async function runJob(job: JobConfig): Promise<void> {
  const t0 = Date.now();
  try {
    logger.info({ job: job.name }, "job.start");
    const result = await job.fn();
    logger.info({ job: job.name, ms: Date.now() - t0, result }, "job.done");
  } catch (err) {
    logger.error({ job: job.name, err: (err as Error).message, stack: (err as Error).stack }, "job.failed");
  }
}
