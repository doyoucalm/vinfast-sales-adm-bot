import { redis } from "./redis.js";

const KEY = (noWa: string) => `bot_off:${noWa}`;
const TTL_SEC = 24 * 60 * 60;

export async function isBotOff(noWa: string): Promise<boolean> {
  return (await redis.get(KEY(noWa))) === "1";
}

export async function turnOff(noWa: string): Promise<void> {
  await redis.setex(KEY(noWa), TTL_SEC, "1");
}

export async function turnOn(noWa: string): Promise<void> {
  await redis.del(KEY(noWa));
}

export async function getOffTtl(noWa: string): Promise<number> {
  return await redis.ttl(KEY(noWa));
}
