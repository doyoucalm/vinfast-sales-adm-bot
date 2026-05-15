import { ilike, and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { ompangTracking, spkLeads } from "../db/schema.js";
import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";

// /status <nama>   — semua dokumen
// /stnk <nama>     — STNK saja
// /ompang <nama>   — Ompang/balik nama saja
// /faktur <nama>   — Faktur saja

const CMD_RE = /^\/?(status|stnk|ompang|faktur)\s+(.+)/i;

export function isStatusCommand(text: string): boolean {
  return CMD_RE.test(text.trim());
}

export async function handleStatusCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;

  const match = ctx.msg.text.trim().match(CMD_RE);
  if (!match) {
    const cmd = ctx.msg.text.trim().split(/\s+/)[0] ?? "/status";
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Contoh: ${cmd} Budi Santoso`,
      { delayMs: 300 }
    );
    return;
  }

  const cmd   = match[1]!.toLowerCase() as "status" | "stnk" | "ompang" | "faktur";
  const query = match[2]!.trim();
  const role  = ctx.karyawan.role;

  // Sales: only allowed to query their own customers
  if (role.startsWith("sales")) {
    const ownLead = await db
      .select({ namaPembeli: spkLeads.namaPembeli })
      .from(spkLeads)
      .where(
        and(
          eq(spkLeads.salesWa, ctx.msg.fromNumber),
          ilike(spkLeads.namaPembeli, `%${query}%`)
        )
      )
      .limit(1);

    if (ownLead.length === 0) {
      await evolution.sendText(
        ctx.msg.fromNumber,
        `Tidak ditemukan SPK atas nama "${query}" di data kamu.`,
        { delayMs: 400 }
      );
      return;
    }
  }

  const rows = await db
    .select()
    .from(ompangTracking)
    .where(ilike(ompangTracking.namaStnk, `%${query}%`))
    .limit(5);

  if (rows.length === 0) {
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Tidak ada data dokumen untuk "${query}".`,
      { delayMs: 400 }
    );
    return;
  }

  for (const row of rows) {
    await evolution.sendText(ctx.msg.fromNumber, formatStatus(row, cmd), { delayMs: 500 });
  }
}

function fmt(d: string | null | undefined): string {
  if (!d) return "_belum_";
  const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const [y, m, dd] = parts;
  const mi = parseInt(m ?? "0", 10) - 1;
  return `${parseInt(dd ?? "0", 10)} ${BULAN[mi] ?? m} ${y}`;
}

function formatStatus(
  row: typeof ompangTracking.$inferSelect,
  section: "status" | "stnk" | "ompang" | "faktur"
): string {
  const lines: string[] = [];
  lines.push(`📋 *Status Dokumen*: ${row.namaStnk ?? "-"}`);
  if (row.vin) lines.push(`VIN: \`${row.vin}\``);
  lines.push("");

  const showAll    = section === "status";
  const showOmpang = showAll || section === "ompang";
  const showFaktur = showAll || section === "faktur";
  const showStnk   = showAll || section === "stnk";

  if (showOmpang) {
    lines.push("*Ompang / Balik Nama*");
    lines.push(`  Pengajuan    : ${fmt(row.tglPengajuanOmpang)}`);
    lines.push(`  Penerimaan   : ${fmt(row.tglPenerimaanOmpang)}`);
    lines.push(`  Serah Terima : ${fmt(row.tglSerahTerimaOmpang)}`);
    lines.push("");
  }

  if (showFaktur) {
    lines.push("*Faktur*");
    lines.push(`  Pengajuan    : ${fmt(row.tglPengajuanFaktur)}`);
    lines.push(`  Penerimaan   : ${fmt(row.tglPenerimaanFaktur)}`);
    lines.push(`  Status       : ${row.statusFaktur ?? "_belum_"}`);
    if (row.noInvoice) lines.push(`  Invoice      : ${row.noInvoice}`);
    lines.push("");
  }

  if (showStnk) {
    lines.push("*STNK*");
    lines.push(`  Pengajuan    : ${fmt(row.tglPengajuanStnkBpkb)}`);
    if (row.noSuratPengajuan) lines.push(`  No. Surat    : ${row.noSuratPengajuan}`);
    lines.push(`  Penerimaan   : ${fmt(row.tglPenerimaanStnk)}`);
    lines.push(`  Serah Terima : ${fmt(row.tglSerahTerimaStnk)}`);
    lines.push("");
    lines.push("*BPKB*");
    lines.push(`  Terima Biro  : ${fmt(row.tglPenerimaanBpkbBiro)}`);
    lines.push(`  Serah Terima : ${fmt(row.tglSerahTerimaBpkb)}`);
  }

  return lines.join("\n").trimEnd();
}
