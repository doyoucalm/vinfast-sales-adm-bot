import { AuthContext } from "../middleware/auth-wa.js";
import { evolution } from "../services/evolution.js";

export function isHelp(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "/help" || t === "help" || t === "?" || t === "menu";
}

export async function handleHelp(ctx: AuthContext): Promise<void> {
  if (!ctx.karyawan) return;

  const lines = [
    `Halo ${ctx.namaPanggilan}, berikut perintah yang tersedia:`,
    "",
    "*Input Data*",
    "• /spk — Input SPK baru (form + KTP + bukti TF)",
    "• /lengkapi — Lampirkan KTP/TF nyusul (cari by nama atau kode SPK)",
    "• /setoran — Input pembayaran lanjutan (booking-2, DP, pelunasan)",
    "• /tf <NO_SPK> — Shortcut kirim bukti TF langsung by kode SPK",
    "• /batal — Batalkan proses yang sedang berjalan",
    "",
    "*Foto Dokumen (tanpa /spk)*",
    "• Kirim foto KTP + caption *ktp*",
    "• Kirim foto bukti TF + caption *tf*",
    "",
    "*Sesi*",
    "• /manual — Matikan bot (mode chat manusia)",
    "• /start — Aktifkan bot kembali",
    "• /help — Tampilkan menu ini",
  ];

  await evolution.sendText(ctx.msg.fromNumber, lines.join("\n"), { delayMs: 500 });
}
