import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  OPENROUTER_API_KEY: z.string().startsWith("sk-or-"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL_NLU: z.string().default("deepseek/deepseek-chat"),
  LLM_MODEL_VISION: z.string().default("google/gemini-2.5-flash"),
  LLM_CACHE_TTL_SEC: z.coerce.number().int().positive().default(3600),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  LLM_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  LLM_CIRCUIT_BREAKER_COOLDOWN_SEC: z.coerce.number().int().positive().default(300),

  SP_TENANT_ID: z.string().uuid(),
  SP_CLIENT_ID: z.string().uuid(),
  SP_TOKEN_FILE: z.string(),
  SP_SITE_URL: z.string().url(),
  SP_DOCUMENTS_PATH: z.string(),
  SP_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(21600000), // legacy — kept for compat
  SP_FILES: z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  SP_KARYAWAN_FILE: z.string().default(""),
  SP_KARYAWAN_SHEET: z.string().default("Karyawan"),
  SP_KARYAWAN_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(86400000), // 24h daily check (etag-gated → effectively monthly)
  SYNC_SPK_INTERVAL_MS: z.coerce.number().int().positive().default(600000), // 10 min
  SCHEDULER_ENABLED: z.coerce.boolean().default(true),

  GOOGLE_SA_KEY_FILE: z.string(),
  GDRIVE_ROOT_FOLDER_ID: z.string().min(1),
  GSHEETS_INBOX_ID: z.string().min(1),

  EVOLUTION_BASE_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE_NAME: z.string().min(1).default("vinfast-bot"),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16),

  UPLOADS_DIR: z.string().default("/opt/sales-bot/uploads"),
  UPLOADS_MAX_SIZE_MB: z.coerce.number().int().positive().default(10),
  PUBLIC_BASE_URL: z.string().url().default("https://vinfast.caricreatormu.my.id"),
  MEDIA_PREVIEW_USER: z.string().default("admin"),
  MEDIA_PREVIEW_PASS: z.string().min(8),

  SUPER_ADMIN_PHONE: z.string().regex(/^\d{10,15}$/),

  SP_OMPANG_FILE: z.string().default(""),
  SYNC_OMPANG_INTERVAL_MS: z.coerce.number().int().positive().default(86400000), // 24h daily

  DAILY_REPORT_ENABLED: z.coerce.boolean().default(true),

  RATELIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATELIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
