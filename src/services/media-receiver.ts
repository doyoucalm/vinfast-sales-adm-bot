import { evolution } from "./evolution.js";
import { saveMedia, MediaCategory, SavedMedia } from "./media-storage.js";
import { logger } from "./logger.js";
import { InboundMessage } from "../types/evolution.js";

export interface ReceiveMediaOptions {
  category: MediaCategory;
  subfolder: string;
  label?: string;
}

export async function receiveMedia(
  msg: InboundMessage,
  opts: ReceiveMediaOptions
): Promise<SavedMedia | null> {
  if (msg.type !== "image" && msg.type !== "document") {
    logger.warn({ type: msg.type, msgId: msg.messageId }, "Not media message");
    return null;
  }

  const media = await evolution.getMediaBase64(msg.messageId);
  if (!media) {
    logger.error({ msgId: msg.messageId }, "Failed to download media from Evolution");
    return null;
  }

  try {
    return await saveMedia({
      base64: media.base64,
      mimeType: media.mimetype,
      category: opts.category,
      subfolder: opts.subfolder,
      label: opts.label ?? msg.type.toUpperCase(),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, msgId: msg.messageId }, "Save media failed");
    return null;
  }
}
