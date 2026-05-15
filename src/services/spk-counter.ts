import { redis } from "./redis.js";

export async function nextSpkTempNumber(): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const key = `spk:counter:${yyyy}-${mm}`;

  const n = await redis.incr(key);
  if (n === 1) {
    await redis.expire(key, 60 * 24 * 60 * 60); // 60 days
  }

  return `SPK-DRAFT-${yyyy}-${mm}-${String(n).padStart(3, "0")}`;
}
