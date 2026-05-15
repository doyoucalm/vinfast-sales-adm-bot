import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../services/logger.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err: err.message }, "Postgres pool error");
});

export const db = drizzle(pool, { schema, logger: env.NODE_ENV === "development" });

export async function dbHealth(): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1 as ok");
    return r.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function dbClose() {
  await pool.end();
}
