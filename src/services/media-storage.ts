import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "./logger.js";
import { env } from "../config/env.js";

export type MediaCategory = "SPK" | "KTP" | "SETORAN" | "MISC";

export interface SavedMedia {
  category: MediaCategory;
  subfolder: string;
  filename: string;
  absPath: string;
  relPath: string;
  previewUrl: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  ext: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const MAX_BYTES = 25 * 1024 * 1024;

export async function saveMedia(opts: {
  category: MediaCategory;
  subfolder: string;
  base64: string;
  mimeType: string;
  label?: string;
}): Promise<SavedMedia> {
  const { category, subfolder, base64, mimeType, label } = opts;

  const buf = Buffer.from(base64, "base64");
  if (buf.length > MAX_BYTES) {
    throw new Error(`File too large: ${buf.length} bytes (max ${MAX_BYTES})`);
  }

  const ext = EXT_BY_MIME[mimeType.toLowerCase()] ?? "bin";
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label ? label.replace(/[^A-Z0-9_-]/gi, "_") : "FILE";
  const filename = `${safeLabel}_${ts}_${sha256.slice(0, 8)}.${ext}`;

  const dir = path.join(env.UPLOADS_DIR, category, subfolder);
  await fs.mkdir(dir, { recursive: true });

  const absPath = path.join(dir, filename);
  await fs.writeFile(absPath, buf, { mode: 0o640 });

  const relPath = path.join(category, subfolder, filename).replace(/\\/g, "/");
  const previewUrl = `${env.PUBLIC_BASE_URL}/media/${relPath}`;

  logger.info({ category, subfolder, filename, size: buf.length, sha256: sha256.slice(0, 12) }, "media.saved");

  return { category, subfolder, filename, absPath, relPath, previewUrl, sizeBytes: buf.length, sha256, mimeType, ext };
}

export async function statMedia(relPath: string): Promise<{ exists: boolean; sizeBytes?: number }> {
  try {
    const stat = await fs.stat(path.join(env.UPLOADS_DIR, relPath));
    return { exists: true, sizeBytes: stat.size };
  } catch {
    return { exists: false };
  }
}
