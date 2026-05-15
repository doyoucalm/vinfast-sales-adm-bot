import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let _drive: drive_v3.Drive | null = null;

async function getClient(): Promise<drive_v3.Drive> {
  if (_drive) return _drive;
  const auth = new google.auth.GoogleAuth({
    keyFile: env.GOOGLE_SA_KEY_FILE,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
  _drive = google.drive({ version: "v3", auth: await auth.getClient() as drive_v3.Drive["context"]["_options"]["auth"] });
  return _drive;
}

// In-memory folder cache: `${parentId}/${name}` → folderId
const folderCache = new Map<string, string>();

async function ensureFolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const drive = await getClient();
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  const found = list.data.files?.[0];
  if (found?.id) {
    folderCache.set(cacheKey, found.id);
    return found.id;
  }

  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  const id = created.data.id!;
  folderCache.set(cacheKey, id);
  logger.info({ name, parent: parentId, id }, "drive.folder.created");
  return id;
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
  webContentLink: string;
}

/**
 * Upload a file to Drive under /<yyyymm>/<subfolder>/<filename>.
 * Folder structure is created on-demand and cached in memory.
 */
export async function driveUpload(
  absPath: string,
  opts: { subfolder: string; yyyymm: string; mimeType: string; filename?: string }
): Promise<DriveUploadResult> {
  const drive = await getClient();
  const monthFolder = await ensureFolder(opts.yyyymm, env.GDRIVE_ROOT_FOLDER_ID);
  const targetFolder = await ensureFolder(opts.subfolder, monthFolder);

  const buf = await readFile(absPath);
  const name = opts.filename ?? basename(absPath);

  const t0 = Date.now();
  const res = await drive.files.create({
    requestBody: { name, parents: [targetFolder] },
    media: { mimeType: opts.mimeType, body: Readable.from(buf) },
    fields: "id,webViewLink,webContentLink",
  });

  logger.info({ name, folder: opts.subfolder, ms: Date.now() - t0 }, "drive.upload.ok");
  return {
    fileId: res.data.id!,
    webViewLink: res.data.webViewLink ?? "",
    webContentLink: res.data.webContentLink ?? "",
  };
}

export { extname };
