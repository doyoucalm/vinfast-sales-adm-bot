/**
 * Normalize WhatsApp number to international format without leading +
 * 082218255795 → 6282218255795
 * +62 821-1825-5795 → 6282118255795
 * 0881023653810 → 62881023653810 (Smartfren 13-digit OK)
 */
export function normalizeNoWa(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;

  // Remove all non-digit chars
  s = s.replace(/[^\d+]/g, "");
  s = s.replace(/^\+/, "");

  // Strip leading zeros
  s = s.replace(/^0+/, "");

  // Indonesia: must start with "62" or "8"
  if (s.startsWith("62")) {
    // ok
  } else if (s.startsWith("8")) {
    s = "62" + s;
  } else {
    return null;
  }

  // Validate length: 62 + 9-13 digits total = 11-15 chars
  if (!/^628\d{8,12}$/.test(s)) return null;
  return s;
}

/**
 * Normalize jabatan → canonical lowercase + role classification
 */
export type RoleCode = "owner" | "admin" | "manager" | "sales" | "sales_senior" | "sales_junior" | "sales_trainee" | "other";

export type JabatanResult = {
  jabatan: string;
  role: RoleCode;
};

const JABATAN_RULES: { match: RegExp; jabatan: string; role: RoleCode }[] = [
  { match: /\bowner\b/i, jabatan: "owner", role: "owner" },
  { match: /\b(ceo|direktur)\b/i, jabatan: "owner", role: "owner" },
  { match: /\barea\s*manager\b/i, jabatan: "area manager", role: "manager" },
  { match: /\bbranch\s*manager\b/i, jabatan: "branch manager", role: "manager" },
  { match: /\bmanager\b/i, jabatan: "manager", role: "manager" },
  { match: /\badmin/i, jabatan: "admin", role: "admin" },
  { match: /\bsales\s*consultant\s*senior\b/i, jabatan: "sales consultant senior", role: "sales_senior" },
  { match: /\bsenior\b.*\bsales\b/i, jabatan: "sales consultant senior", role: "sales_senior" },
  { match: /\bjunior\s*sales\s*consultant\b/i, jabatan: "junior sales consultant", role: "sales_junior" },
  { match: /\bjunior\b.*\bsales\b/i, jabatan: "junior sales consultant", role: "sales_junior" },
  { match: /\btraining\b/i, jabatan: "training", role: "sales_trainee" },
  { match: /\btrainee\b/i, jabatan: "training", role: "sales_trainee" },
  { match: /\bsales\b/i, jabatan: "sales", role: "sales" },
  { match: /\bfinance\b/i, jabatan: "finance", role: "admin" },
  { match: /\bkeuangan\b/i, jabatan: "finance", role: "admin" },
];

export function normalizeJabatan(input: string | null | undefined): JabatanResult {
  if (!input) return { jabatan: "other", role: "other" };
  const s = String(input).trim();
  if (!s) return { jabatan: "other", role: "other" };

  for (const rule of JABATAN_RULES) {
    if (rule.match.test(s)) {
      return { jabatan: rule.jabatan, role: rule.role };
    }
  }
  return { jabatan: s.toLowerCase(), role: "other" };
}

/**
 * Normalize nama: trim + collapse multiple spaces + Title Case
 */
export function normalizeNama(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/**
 * Normalize Aktif / aktif / Aktif (trailing space) → true
 */
export function normalizeAktif(input: unknown): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input !== 0;
  if (typeof input === "string") {
    const s = input.trim().toLowerCase();
    return ["aktif", "active", "true", "1", "yes", "y", "ya"].includes(s);
  }
  return false;
}

/**
 * Parse date string DD/MM/YYYY → Date
 */
export function parseDateID(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`);
  return isNaN(d.getTime()) ? null : d;
}

export function normalizeTipeMobil(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.toUpperCase().replace(/\s+/g, "").match(/VF(3|5|6|7|8|9)/i);
  return match ? `VF${match[1]}` : null;
}

export function normalizeBaterai(input: string | null | undefined): "SEWA" | "BELI" | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v.includes("sewa") || v.includes("subscription")) return "SEWA";
  if (v.includes("beli") || v.includes("own")) return "BELI";
  return null;
}

export function normalizePembayaran(input: string | null | undefined): "CASH" | "KREDIT" | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v.includes("cash") || v === "tunai") return "CASH";
  if (v.includes("kredit") || v.includes("credit")) return "KREDIT";
  return null;
}

export function normalizeWarna(input: string | null | undefined): string | null {
  if (!input) return null;
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeNominal(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = String(input).replace(/[Rp.,\s]/gi, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeNamaProperCase(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
}
