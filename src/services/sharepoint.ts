import { readFile, writeFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

interface SpToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope?: string;
  token_type?: string;
}

let _cached: SpToken | null = null;

async function readToken(): Promise<SpToken> {
  if (_cached && _cached.expires_at > Date.now() + 5 * 60_000) return _cached;

  const raw = await readFile(env.SP_TOKEN_FILE, "utf8");
  const parsed = JSON.parse(raw) as Partial<SpToken> & {
    expires_in?: number;
    obtained_at?: number;
  };

  // Backward compat: oauth flow files usually have expires_in + obtained_at instead of expires_at
  let expires_at = parsed.expires_at ?? 0;
  if (!expires_at && parsed.expires_in && parsed.obtained_at) {
    expires_at = parsed.obtained_at + parsed.expires_in * 1000;
  }

  if (!parsed.access_token || !parsed.refresh_token) {
    throw new Error("sp-token.json missing access_token or refresh_token");
  }

  _cached = {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expires_at,
    scope: parsed.scope,
    token_type: parsed.token_type,
  };
  return _cached;
}

async function refreshToken(): Promise<SpToken> {
  if (!_cached) await readToken();
  const cur = _cached!;

  const host = new URL(env.SP_SITE_URL).host;
  const tokenUrl = `https://login.microsoftonline.com/${env.SP_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.SP_CLIENT_ID,
    refresh_token: cur.refresh_token,
    scope: `https://${host}/AllSites.Read offline_access`,
  });

  const t0 = Date.now();
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 500) }, "sp.refresh.failed");
    throw new Error(`SP token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };

  const next: SpToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? cur.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
  _cached = next;

  // Persist so next process boot gets a fresh token (sliding 90-day window needs this)
  await writeFile(
    env.SP_TOKEN_FILE,
    JSON.stringify(
      {
        access_token: next.access_token,
        refresh_token: next.refresh_token,
        expires_at: next.expires_at,
        expires_in: data.expires_in,
        obtained_at: Date.now(),
        scope: next.scope,
        token_type: next.token_type,
      },
      null,
      2
    ),
    "utf8"
  );

  logger.info({ ms: Date.now() - t0, expires_in: data.expires_in }, "sp.refresh.ok");
  return next;
}

async function getAccessToken(): Promise<string> {
  const cur = await readToken();
  if (cur.expires_at > Date.now() + 5 * 60_000) return cur.access_token;
  const refreshed = await refreshToken();
  return refreshed.access_token;
}

/**
 * Download a file from SharePoint by server-relative path.
 * Returns raw Buffer (suitable for ExcelJS or binary write).
 */
export async function spDownloadFile(serverRelativePath: string): Promise<Buffer> {
  const token = await getAccessToken();
  const encoded = encodeURIComponent(serverRelativePath);
  const url = `${env.SP_SITE_URL.replace(/\/$/, "")}/_api/web/getfilebyserverrelativeurl('${encoded}')/$value`;

  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/octet-stream" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, path: serverRelativePath, body: text.slice(0, 300) }, "sp.download.failed");
    throw new Error(`SP download failed ${res.status}: ${serverRelativePath}`);
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  logger.info({ path: serverRelativePath, bytes: buf.length, ms: Date.now() - t0 }, "sp.download.ok");
  return buf;
}

/**
 * Get file metadata (TimeLastModified) — cheap check before downloading.
 */
export async function spGetFileMeta(serverRelativePath: string): Promise<{
  TimeLastModified: string;
  Length: string;
  Name: string;
}> {
  const token = await getAccessToken();
  const encoded = encodeURIComponent(serverRelativePath);
  const url =
    `${env.SP_SITE_URL.replace(/\/$/, "")}/_api/web/getfilebyserverrelativeurl('${encoded}')` +
    `?$select=TimeLastModified,Length,Name`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;odata=nometadata" },
  });

  if (!res.ok) throw new Error(`SP meta failed ${res.status}: ${serverRelativePath}`);
  return (await res.json()) as { TimeLastModified: string; Length: string; Name: string };
}
