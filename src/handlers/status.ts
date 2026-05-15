import { ilike, and, or, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { ompangTracking, spkLeads } from "../db/schema.js";
import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";

// /status                    — ringkasan pending semua kategori
// /status <nama|VIN>         — detail semua dokumen
// /stnk                      — list STNK pending
// /stnk <nama|VIN>           — detail STNK
// /ompang                    — list Ompang pending
// /ompang <nama|VIN>         — detail Ompang
// /faktur                    — list Faktur pending
// /faktur <nama|VIN>         — detail Faktur

const CMD_RE = /^\/?(status|stnk|ompang|faktur)(?:\s+(.+))?$/i;
const LIST_LIMIT = 20;

type Section = "status" | "stnk" | "ompang" | "faktur";

export function isStatusCommand(text: string): boolean {
  return CMD_RE.test(text.trim());
}

export async function handleStatusCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;

  const match = ctx.msg.text.trim().match(CMD_RE);
  if (!match) return;

  const cmd   = match[1]!.toLowerCase() as Section;
  const query = match[2]?.trim() ?? null;
  const role  = ctx.karyawan.role;

  // Sales: wajib query, hanya boleh akses customer sendiri (cek spkLeads.salesWa)
  if (role.startsWith("sales")) {
    if (!query) {
      await evolution.sendText(
        ctx.msg.fromNumber,
        `Sales harus pakai argumen: /${cmd} <nama atau VIN>`,
        { delayMs: 300 }
      );
      return;
    }
    const ownLead = await db
      .select({ namaPembeli: spkLeads.namaPembeli })
      .from(spkLeads)
      .where(
        and(
          eq(spkLeads.salesWa, ctx.msg.fromNumber),
          or(
            ilike(spkLeads.namaPembeli, `%${query}%`),
            ilike(spkLeads.fotoKtpPembeli, `%${query}%`),
          )
        )
      )
      .limit(1);

    if (ownLead.length === 0) {
      await evolution.sendText(
        ctx.msg.fromNumber,
        `Tidak ditemukan SPK atas "${query}" di data kamu.`,
        { delayMs: 400 }
      );
      return;
    }
  }

  // Dealer scope: manager hanya dealer-nya sendiri; owner/admin unrestricted
  const dealerFilter =
    role === "manager" && ctx.karyawan.dealer ? ctx.karyawan.dealer : null;

  if (query) {
    await handleLookup(ctx, cmd, query, dealerFilter);
  } else {
    await handleList(ctx, cmd, dealerFilter);
  }
}

async function handleLookup(
  ctx: AuthContext,
  cmd: Section,
  query: string,
  dealerFilter: string | null,
): Promise<void> {
  const conditions = [
    or(
      ilike(ompangTracking.namaStnk, `%${query}%`),
      ilike(ompangTracking.vin, `%${query}%`),
    ),
  ];
  if (dealerFilter) conditions.push(eq(ompangTracking.dealer, dealerFilter));

  const rows = await db
    .select()
    .from(ompangTracking)
    .where(and(...conditions))
    .limit(5);

  if (rows.length === 0) {
    const scope = dealerFilter ? ` di ${dealerFilter}` : "";
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Tidak ada data dokumen untuk "${query}"${scope}.`,
      { delayMs: 400 }
    );
    return;
  }

  for (const row of rows) {
    await evolution.sendText(ctx.msg.fromNumber, formatStatus(row, cmd), { delayMs: 500 });
  }
}

async function handleList(
  ctx: AuthContext,
  cmd: Section,
  dealerFilter: string | null,
): Promise<void> {
  // /status no-arg → ringkasan count semua kategori
  if (cmd === "status") {
    await sendSummary(ctx, dealerFilter);
    return;
  }

  const pendingExpr = pendingCondition(cmd);
  const conditions = [pendingExpr];
  if (dealerFilter) conditions.push(eq(ompangTracking.dealer, dealerFilter));

  const rows = await db
    .select()
    .from(ompangTracking)
    .where(and(...conditions))
    .orderBy(ompangTracking.dealer, ompangTracking.namaStnk)
    .limit(LIST_LIMIT);

  if (rows.length === 0) {
    const scope = dealerFilter ? ` di ${dealerFilter}` : "";
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Tidak ada ${cmdLabel(cmd)} pending${scope}. 🎉`,
      { delayMs: 400 }
    );
    return;
  }

  const totalRows = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(ompangTracking)
    .where(and(...conditions));
  const total = Number(totalRows[0]?.cnt ?? 0);

  const scopeLabel = dealerFilter ?? "Semua Dealer";
  const lines: string[] = [];
  lines.push(`📋 *${cmdLabel(cmd)} Pending* — ${scopeLabel}`);
  lines.push("");

  if (!dealerFilter) {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.dealer ?? "(tanpa dealer)";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    for (const [dealer, grp] of groups) {
      lines.push(`*${dealer}* (${grp.length})`);
      for (let i = 0; i < grp.length; i++) {
        lines.push(formatListLine(grp[i]!, cmd, i + 1));
      }
      lines.push("");
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      lines.push(formatListLine(rows[i]!, cmd, i + 1));
    }
    lines.push("");
  }

  lines.push(`Total: *${total}*${total > rows.length ? ` (tampil ${rows.length})` : ""}`);
  lines.push(`Detail: */${cmd} <nama|VIN>*`);

  await evolution.sendText(ctx.msg.fromNumber, lines.join("\n").trimEnd(), { delayMs: 500 });
}

async function sendSummary(ctx: AuthContext, dealerFilter: string | null): Promise<void> {
  const baseCond = dealerFilter ? [eq(ompangTracking.dealer, dealerFilter)] : [];

  const [stnkRow, fakturRow, ompangRow] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)` })
      .from(ompangTracking)
      .where(and(...baseCond, pendingCondition("stnk"))),
    db.select({ cnt: sql<number>`count(*)` })
      .from(ompangTracking)
      .where(and(...baseCond, pendingCondition("faktur"))),
    db.select({ cnt: sql<number>`count(*)` })
      .from(ompangTracking)
      .where(and(...baseCond, pendingCondition("ompang"))),
  ]);

  const stnk   = Number(stnkRow[0]?.cnt   ?? 0);
  const faktur = Number(fakturRow[0]?.cnt ?? 0);
  const ompang = Number(ompangRow[0]?.cnt ?? 0);

  const scopeLabel = dealerFilter ?? "Semua Dealer";
  const lines = [
    `📊 *Ringkasan Dokumen Pending* — ${scopeLabel}`,
    "",
    `• Ompang : *${ompang}* berkas`,
    `• Faktur : *${faktur}* berkas`,
    `• STNK   : *${stnk}* berkas`,
    "",
    "Detail: */stnk*, */faktur*, */ompang* (tanpa argumen utk list)",
    "Cari  : */status <nama|VIN>*",
  ];

  await evolution.sendText(ctx.msg.fromNumber, lines.join("\n"), { delayMs: 500 });
}

function pendingCondition(cmd: Exclude<Section, "status">) {
  switch (cmd) {
    case "stnk":   return isNull(ompangTracking.tglSerahTerimaStnk);
    case "faktur": return isNull(ompangTracking.tglPenerimaanFaktur);
    case "ompang": return isNull(ompangTracking.tglSerahTerimaOmpang);
  }
}

function cmdLabel(cmd: Section): string {
  switch (cmd) {
    case "stnk":   return "STNK";
    case "faktur": return "Faktur";
    case "ompang": return "Ompang / Balik Nama";
    case "status": return "Dokumen";
  }
}

function formatListLine(
  row: typeof ompangTracking.$inferSelect,
  cmd: Section,
  idx: number,
): string {
  const pengajuan =
    cmd === "faktur" ? row.tglPengajuanFaktur :
    cmd === "ompang" ? row.tglPengajuanOmpang :
    row.tglPengajuanStnkBpkb;
  const tgl = pengajuan ? ` — diajukan ${fmt(pengajuan)}` : "";
  const vinTail = row.vin ? ` (${row.vin.slice(-6)})` : "";
  return `${idx}. ${row.namaStnk ?? "-"}${vinTail}${tgl}`;
}

function fmt(d: string | null | undefined): string {
  if (!d) return "_belum_";
  // ISO date YYYY-MM-DD → pretty Indo
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
    const [, y, m, dd] = iso;
    const mi = parseInt(m ?? "0", 10) - 1;
    return `${parseInt(dd ?? "0", 10)} ${BULAN[mi] ?? m} ${y}`;
  }
  // Non-date marker (e.g. "DONE") — tampilkan apa adanya
  return d.trim();
}

function formatStatus(
  row: typeof ompangTracking.$inferSelect,
  section: Section,
): string {
  const lines: string[] = [];
  lines.push(`📋 *Status Dokumen*: ${row.namaStnk ?? "-"}`);
  if (row.vin) lines.push(`VIN: \`${row.vin}\``);
  if (row.dealer) lines.push(`Dealer: ${row.dealer}`);
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
