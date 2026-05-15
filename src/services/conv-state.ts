import { redis } from "./redis.js";

export interface ConvState {
  flow: string;
  step: string;
  data: unknown;
}

const TTL_SEC = 600; // 10 min idle timeout
const key = (noWa: string) => `conv:${noWa}:state`;

export async function getConvState(noWa: string): Promise<ConvState | null> {
  const raw = await redis.get(key(noWa));
  return raw ? (JSON.parse(raw) as ConvState) : null;
}

export async function setConvState(noWa: string, state: ConvState, ttlSec = TTL_SEC): Promise<void> {
  await redis.setex(key(noWa), ttlSec, JSON.stringify(state));
}

export async function clearConvState(noWa: string): Promise<void> {
  await redis.del(key(noWa));
}
