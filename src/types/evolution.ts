/**
 * Evolution API webhook payload types
 * Reference: https://doc.evolution-api.com/
 */

export type EvolutionEventType =
  | "messages.upsert"
  | "messages.update"
  | "connection.update"
  | "qrcode.updated"
  | "send.message";

export interface EvolutionWebhookBody {
  event: EvolutionEventType;
  instance: string;
  data: EvolutionMessageData | Record<string, unknown>;
  destination?: string;
  date_time?: string;
  sender?: string;
  server_url?: string;
  apikey?: string;
}

export interface EvolutionMessageData {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  };
  pushName?: string;
  status?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text: string };
    imageMessage?: EvolutionMediaMessage;
    documentMessage?: EvolutionMediaMessage;
    audioMessage?: EvolutionMediaMessage;
    videoMessage?: EvolutionMediaMessage;
    [key: string]: unknown;
  };
  messageType?: string;
  messageTimestamp?: number;
  instanceId?: string;
}

export interface EvolutionMediaMessage {
  caption?: string;
  mimetype?: string;
  fileLength?: string | number;
  url?: string;
  mediaKey?: string;
  fileSha256?: string;
  [key: string]: unknown;
}

/**
 * Normalized inbound message — abstraksi dari raw Evolution payload
 */
export interface InboundMessage {
  instance: string;
  messageId: string;
  fromJid: string;
  fromNumber: string;
  fromMe: boolean;
  isGroup: boolean;
  groupJid?: string;
  pushName?: string;
  text: string;
  type: "text" | "image" | "document" | "audio" | "video" | "other";
  mediaCaption?: string;
  timestamp: Date;
  raw: EvolutionMessageData;
}
