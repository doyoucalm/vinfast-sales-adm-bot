import { db } from "../db/client.js";
import { messageLog } from "../db/schema.js";
import { logger } from "../services/logger.js";

export interface LogMessageInput {
  karyawan_id?: number | null;
  wa_number: string;
  direction: "in" | "out";
  message_text?: string;
  message_type?: string;
  intent?: string;
  confidence?: number;
  entities?: unknown;
  handler?: string;
  response_time_ms?: number;
  llm_used?: boolean;
  status?: string;
  error_msg?: string;
}

export async function logMessage(input: LogMessageInput): Promise<void> {
  try {
    await db.insert(messageLog).values({
      userId: null, // Phase 2: rename to karyawan_id + FK ke karyawan table
      waNumber: input.wa_number,
      direction: input.direction,
      messageText: input.message_text ?? null,
      messageType: input.message_type ?? null,
      intent: input.intent ?? null,
      confidence: input.confidence != null ? String(input.confidence) : null,
      entities: input.entities ?? null,
      handler: input.handler ?? null,
      responseTimeMs: input.response_time_ms ?? null,
      llmUsed: input.llm_used ?? false,
      status: input.status ?? null,
      errorMsg: input.error_msg ?? null,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "logMessage failed (non-fatal)");
  }
}
