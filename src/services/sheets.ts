import { google, sheets_v4 } from "googleapis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let _sheets: sheets_v4.Sheets | null = null;

async function getClient(): Promise<sheets_v4.Sheets> {
  if (_sheets) return _sheets;
  const auth = new google.auth.GoogleAuth({
    keyFile: env.GOOGLE_SA_KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _sheets = google.sheets({ version: "v4", auth: (await auth.getClient()) as Parameters<typeof google.sheets>[0]["auth"] });
  return _sheets;
}

export async function appendRow(tab: string, row: (string | number | null)[]): Promise<void> {
  const sheets = await getClient();
  const t0 = Date.now();
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.GSHEETS_INBOX_ID,
      range: `${tab}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row.map((v) => v ?? "")] },
    });
    logger.info({ tab, ms: Date.now() - t0 }, "sheets.appendRow.ok");
  } catch (err) {
    logger.error({ err, tab }, "sheets.appendRow.failed");
    throw err;
  }
}

export async function readAllRows(tab: string): Promise<{
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
}> {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GSHEETS_INBOX_ID,
    range: `${tab}!A:ZZ`,
  });
  const values = (res.data.values ?? []) as string[][];
  if (values.length === 0) return { headers: [], rows: [], rowNumbers: [] };
  const headers = values[0] ?? [];
  const rows = values.slice(1);
  const rowNumbers = rows.map((_, idx) => idx + 2);
  return { headers, rows, rowNumbers };
}

export interface FoundSpk {
  rowNumber: number;
  no_spk_temp: string;
  nama_pembeli: string;
  sales_wa: string;
  sales_nama: string;
  status_lengkap: string;
  tipe_mobil: string;
  warna: string;
  raw: Record<string, string>;
}

export async function findSpkInLeads(query: string): Promise<FoundSpk[]> {
  const { headers, rows, rowNumbers } = await readAllRows("Leads_SPK");
  if (rows.length === 0) return [];

  const colIdx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iNoSpk    = colIdx("no_spk_temp");
  const iNama     = colIdx("nama_pembeli");
  const iSalesWa  = colIdx("sales_wa");
  const iSalesNama = colIdx("sales_nama");
  const iStatus   = colIdx("status_lengkap");
  const iTipe     = colIdx("tipe_mobil");
  const iWarna    = colIdx("warna");

  const q = query.trim().toLowerCase();
  const isSpkCode = /^spk-draft-/i.test(query);

  const matches: FoundSpk[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const noSpk = String(iNoSpk >= 0 ? (row[iNoSpk] ?? "") : "");
    const nama  = String(iNama  >= 0 ? (row[iNama]  ?? "") : "");

    let matched = false;
    if (isSpkCode) {
      matched = noSpk.toLowerCase() === q;
    } else {
      const tokens = q.split(/\s+/).filter(Boolean);
      const namaLower = nama.toLowerCase();
      matched = tokens.every((t) => namaLower.includes(t));
    }
    if (!matched) continue;

    const rn = rowNumbers[i];
    if (rn === undefined) continue;

    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => { raw[h] = (row[idx] ?? "").toString(); });

    matches.push({
      rowNumber:     rn,
      no_spk_temp:   noSpk,
      nama_pembeli:  nama,
      sales_wa:      (iSalesWa  >= 0 ? row[iSalesWa]  : "") ?? "",
      sales_nama:    (iSalesNama >= 0 ? row[iSalesNama]: "") ?? "",
      status_lengkap:(iStatus   >= 0 ? row[iStatus]   : "") ?? "",
      tipe_mobil:    (iTipe     >= 0 ? row[iTipe]     : "") ?? "",
      warna:         (iWarna    >= 0 ? row[iWarna]    : "") ?? "",
      raw,
    });
  }

  matches.sort((a, b) => b.rowNumber - a.rowNumber);
  return matches;
}

function colLetter(col: number): string {
  let s = "";
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

export async function updateRowByNumber(
  tab: string,
  rowNumber: number,
  updates: Record<string, string | number | null>
): Promise<void> {
  const sheets = await getClient();
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GSHEETS_INBOX_ID,
    range: `${tab}!1:1`,
  });
  const headers = ((headerRes.data.values?.[0] ?? []) as string[]);

  const data: sheets_v4.Schema$ValueRange[] = [];
  for (const [header, value] of Object.entries(updates)) {
    const idx = headers.findIndex((h) => h.toLowerCase() === header.toLowerCase());
    if (idx === -1) {
      logger.warn({ tab, header }, "sheets.update.unknown_header");
      continue;
    }
    data.push({
      range: `${tab}!${colLetter(idx + 1)}${rowNumber}`,
      values: [[value ?? ""]],
    });
  }
  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.GSHEETS_INBOX_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
  logger.info({ tab, rowNumber, fields: Object.keys(updates) }, "sheets.updateRow.ok");
}
