import { eq, ilike, and, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { stok } from "../db/schema.js";
import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";

// /do             — lihat semua unit ready di dealer sendiri
// /do <tipe>      — filter by tipe (VF5, VF6, dll)

const CMD_RE = /^\/do(?:\s+(.+))?$/i;

export function isDoCommand(text: string): boolean {
  return CMD_RE.test(text.trim());
}

export async function handleDoCommand(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;

  const match = ctx.msg.text.trim().match(CMD_RE);
  const tipeFilter = match?.[1]?.trim() ?? null;
  const role   = ctx.karyawan.role;
  const dealer = ctx.karyawan.dealer;

  const canSeeAll = role === "owner" || role === "admin";
  const isManager = role === "manager";

  // Build where conditions
  const conditions = [];

  // Status READY (unit tersedia — sudah DO dari pabrik ke dealer)
  conditions.push(eq(stok.status, "READY"));

  if (tipeFilter) {
    conditions.push(ilike(stok.tipeMobil, `%${tipeFilter}%`));
  }

  if (!canSeeAll) {
    // Sales and Manager: filter by their dealer
    if (dealer) {
      conditions.push(eq(stok.lokasi, dealer));
    } else {
      await evolution.sendText(
        ctx.msg.fromNumber,
        "Dealer kamu belum dikonfigurasi. Hubungi admin.",
        { delayMs: 300 }
      );
      return;
    }
  }

  const rows = await db
    .select()
    .from(stok)
    .where(and(...conditions))
    .orderBy(stok.lokasi, stok.tipeMobil, stok.warna)
    .limit(50);

  if (rows.length === 0) {
    const locMsg = canSeeAll ? "semua dealer" : `dealer ${dealer}`;
    const tipeMsg = tipeFilter ? ` (${tipeFilter})` : "";
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Tidak ada unit ready${tipeMsg} di ${locMsg}.`,
      { delayMs: 400 }
    );
    return;
  }

  // Group by lokasi for multi-dealer view
  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const loc = r.lokasi ?? "UNKNOWN";
    if (!grouped.has(loc)) grouped.set(loc, []);
    grouped.get(loc)!.push(r);
  }

  const lines: string[] = [];
  lines.push(`🚗 *Stok Unit Tersedia*`);
  if (tipeFilter) lines.push(`Filter: ${tipeFilter}`);
  lines.push("");

  for (const [lokasi, units] of grouped) {
    if (grouped.size > 1) lines.push(`*${lokasi}* (${units.length} unit)`);
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      const baterai = u.tipeBaterai ? ` | ${u.tipeBaterai}` : "";
      const umur = u.umurHari != null ? ` | ${u.umurHari} hari` : "";
      lines.push(`${i + 1}. ${u.tipeMobil ?? "-"} — ${u.warna ?? "-"}${baterai}${umur}`);
      if (u.vin) lines.push(`   VIN: \`${u.vin}\``);
    }
    lines.push("");
  }

  lines.push(`Total: *${rows.length} unit*`);

  await evolution.sendText(ctx.msg.fromNumber, lines.join("\n").trimEnd(), { delayMs: 500 });
}
