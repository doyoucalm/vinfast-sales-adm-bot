import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on("connect", () => logger.info("Redis connecting..."));
redis.on("ready", () => logger.info("Redis ready"));
redis.on("error", (err) => logger.error({ err: err.message }, "Redis error"));
redis.on("close", () => logger.warn("Redis connection closed"));

export async function redisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
