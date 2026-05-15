import type { ParsedSpk } from "./spk-parser.js";
import type { KtpData, BuktiTfData } from "./ocr.js";

export interface SpkValidationResult {
  warnings: string[];
  matches: {
    ktp_pembeli_nama: "match" | "mismatch" | "skip";
    ktp_stnk_nama: "match" | "mismatch" | "skip";
    tf_nominal: "match" | "mismatch" | "skip";
    tf_berita: "mentions" | "no_mention" | "skip";
  };
}

function nameSimilar(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const tokensA = new Set(na.split(" "));
  const tokensB = new Set(nb.split(" "));
  const common = [...tokensA].filter((t) => tokensB.has(t)).length;
  const minSize = Math.min(tokensA.size, tokensB.size);
  return minSize > 0 && common / minSize >= 0.5;
}

export function validateSpk(
  spk: ParsedSpk,
  ktpPembeli: KtpData | null,
  ktpStnk: KtpData | null,
  tf: BuktiTfData | null
): SpkValidationResult {
  const warnings: string[] = [];
  const matches: SpkValidationResult["matches"] = {
    ktp_pembeli_nama: "skip",
    ktp_stnk_nama: "skip",
    tf_nominal: "skip",
    tf_berita: "skip",
  };

  if (ktpPembeli?.nama && spk.spk_an) {
    if (nameSimilar(ktpPembeli.nama, spk.spk_an)) {
      matches.ktp_pembeli_nama = "match";
    } else {
      matches.ktp_pembeli_nama = "mismatch";
      warnings.push(`Nama KTP Pembeli (${ktpPembeli.nama}) ≠ SPK a.n (${spk.spk_an})`);
    }
  }

  if (ktpStnk?.nama && spk.stnk && ktpStnk !== ktpPembeli) {
    if (nameSimilar(ktpStnk.nama, spk.stnk)) {
      matches.ktp_stnk_nama = "match";
    } else {
      matches.ktp_stnk_nama = "mismatch";
      warnings.push(`Nama KTP STNK (${ktpStnk.nama}) ≠ STNK (${spk.stnk})`);
    }
  }

  if (tf?.nominal != null && spk.booking != null) {
    if (tf.nominal === spk.booking) {
      matches.tf_nominal = "match";
    } else {
      matches.tf_nominal = "mismatch";
      warnings.push(
        `Nominal TF (Rp ${tf.nominal.toLocaleString("id-ID")}) ≠ Booking (Rp ${spk.booking.toLocaleString("id-ID")})`
      );
    }
  }

  if (tf?.berita && (spk.spk_an || spk.type)) {
    const berita = tf.berita.toLowerCase().replace(/\s+/g, "");
    const nameToken = spk.spk_an?.toLowerCase().split(" ")[0] ?? "";
    const typeToken = spk.type?.toLowerCase().replace(/\s+/g, "") ?? "";
    if (
      (nameToken && berita.includes(nameToken)) ||
      (typeToken && berita.includes(typeToken))
    ) {
      matches.tf_berita = "mentions";
    } else {
      matches.tf_berita = "no_mention";
      warnings.push(`Berita TF ("${tf.berita}") tidak mention nama/tipe`);
    }
  }

  return { warnings, matches };
}
