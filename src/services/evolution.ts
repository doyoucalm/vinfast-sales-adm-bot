import axios, { AxiosInstance } from "axios";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export class EvolutionClient {
  private http: AxiosInstance;
  private instance: string;

  constructor() {
    this.instance = env.EVOLUTION_INSTANCE_NAME;
    this.http = axios.create({
      baseURL: env.EVOLUTION_BASE_URL,
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json",
        apikey: env.EVOLUTION_API_KEY,
      },
    });
  }

  async sendText(number: string, text: string, opts?: { quotedMsgId?: string; delayMs?: number }): Promise<void> {
    const cleanNumber = number.replace(/@.*$/, "").replace(/[^\d]/g, "");
    const payload: Record<string, unknown> = { number: cleanNumber, text };
    if (opts?.delayMs) payload.delay = opts.delayMs;
    if (opts?.quotedMsgId) payload.quoted = { key: { id: opts.quotedMsgId } };

    try {
      const res = await this.http.post(`/message/sendText/${this.instance}`, payload);
      logger.debug({ number: cleanNumber, status: res.status }, "WA text sent");
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown }; message: string };
      logger.error({ number: cleanNumber, status: e.response?.status, data: e.response?.data, err: e.message }, "WA send failed");
      throw err;
    }
  }

  async markRead(remoteJid: string, messageId: string): Promise<void> {
    try {
      await this.http.post(`/chat/markMessageAsRead/${this.instance}`, {
        readMessages: [{ remoteJid, id: messageId, fromMe: false }],
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "markRead failed (non-fatal)");
    }
  }

  async getMediaBase64(messageId: string): Promise<{ base64: string; mimetype: string } | null> {
    try {
      const res = await this.http.post(`/chat/getBase64FromMediaMessage/${this.instance}`, {
        message: { key: { id: messageId } },
      });
      return {
        base64: res.data.base64 ?? res.data.media,
        mimetype: res.data.mimetype ?? "application/octet-stream",
      };
    } catch (err) {
      logger.error({ messageId, err: (err as Error).message }, "getMediaBase64 failed");
      return null;
    }
  }

  async connectionState(): Promise<string> {
    try {
      const res = await this.http.get(`/instance/connectionState/${this.instance}`);
      return res.data?.instance?.state ?? "unknown";
    } catch {
      return "error";
    }
  }
}

export const evolution = new EvolutionClient();

// Legacy compat — sendText dan normalizeJid masih dipakai di beberapa tempat
export function normalizeJid(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "");
}

export async function sendText(to: string, text: string): Promise<void> {
  return evolution.sendText(to, text);
}
