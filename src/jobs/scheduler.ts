import { logger } from "../services/logger.js";
import { syncKaryawan } from "./sync-karyawan.js";
import { env } from "../config/env.js";

const HOUR = 60 * 60_000;

interface JobConfig {
  name: string;
  intervalMs: number;
  fn: () => Promise<unknown>;
}

const jobs: JobConfig[] = [
  {
    name: "sync_karyawan",
    intervalMs: env.SP_SYNC_INTERVAL_MS > 0 ? env.SP_SYNC_INTERVAL_MS : 6 * HOUR,
    fn: () => syncKaryawan(),
  },
];

const handles: NodeJS.Timeout[] = [];

export function startScheduler(): void {
  for (const job of jobs) {
    // Run once on boot after 30s warmup delay, then on fixed interval
    setTimeout(() => runJob(job), 30_000);
    const h = setInterval(() => runJob(job), job.intervalMs);
    h.unref(); // don't keep process alive if everything else exits
    handles.push(h);
    logger.info({ job: job.name, intervalMs: job.intervalMs }, "scheduler.started");
  }
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
