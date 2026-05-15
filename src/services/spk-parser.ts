import OpenAI from "openai";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import {
  normalizeTipeMobil,
  normalizeBaterai,
  normalizePembayaran,
  normalizeWarna,
  normalizeNominal,
  normalizeNamaProperCase,
} from "../utils/normalizers.js";

const llm = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.OPENROUTER_BASE_URL,
});

export interface ParsedSpk {
  spk_an: string | null;
  stnk: string | null;
  type: string | null;
  warna: string | null;
  booking: number | null;
  baterai: "SEWA" | "BELI" | null;
  pembayaran: "CASH" | "KREDIT" | null;
  sales: string | null;
  missing: string[];
}

type RawFields = Partial<Record<keyof Omit<ParsedSpk, "missing">, string>>;

function regexParse(text: string): RawFields {
  const out: RawFields = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([a-zA-Z .]+?)\s*:\s*(.+?)\s*$/);
    if (!m || !m[1] || !m[2]) continue;
    const label = m[1].toLowerCase().replace(/\s+/g, " ").trim();
    const value = m[2].trim();
    if (!value) continue;

    if (/^spk\s*a\.?\s*n/.test(label)) out.spk_an = value;
    else if (/^stnk/.test(label)) out.stnk = value;
    else if (/^(type|tipe)/.test(label)) out.type = value;
    else if (/^warna/.test(label)) out.warna = value;
    else if (/^booking/.test(label)) out.booking = value;
    else if (/^bater/.test(label)) out.baterai = value;
    else if (/^pembayaran/.test(label)) out.pembayaran = value;
    else if (/^(nama\s*)?sales/.test(label)) out.sales = value;
  }
  return out;
}

async function llmParse(text: string): Promise<RawFields> {
  const t0 = Date.now();
  try {
    const resp = await llm.chat.completions.create({
      model: env.LLM_MODEL_NLU,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract SPK (sales order) form fields from messy Indonesian WhatsApp messages. Return strictly valid JSON. Use null if missing. Do not invent values.",
        },
        {
          role: "user",
          content: `Extract SPK fields. Return raw values as written. Keys: spk_an, stnk, type, warna, booking, baterai, pembayaran, sales.\n\nMessage:\n"""\n${text}\n"""`,
        },
      ],
    });
    logger.info({ ms: Date.now() - t0 }, "spk.llm.parse.ok");
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const final = (start !== -1 && end !== -1 && end > start) ? cleaned.substring(start, end + 1) : cleaned;
    return JSON.parse(final) as RawFields;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "spk.llm.parse.failed");
    return {};
  }
}

export async function parseSpkTemplate(text: string): Promise<ParsedSpk> {
  let raw = regexParse(text);
  const regexHits = Object.values(raw).filter(Boolean).length;

  if (regexHits < 4) {
    logger.info({ regexHits }, "spk.parse.fallback.llm");
    const llmRaw = await llmParse(text);
    // regex hits take precedence over LLM
    raw = { ...llmRaw, ...raw };
  }

  const spk_an = raw.spk_an ? normalizeNamaProperCase(raw.spk_an) : null;
  const stnkRaw = raw.stnk?.trim() ?? null;
  const stnk =
    stnkRaw && /^sama$/i.test(stnkRaw)
      ? spk_an
      : stnkRaw
        ? normalizeNamaProperCase(stnkRaw)
        : null;

  const type = raw.type ? normalizeTipeMobil(raw.type) : null;
  const warna = raw.warna ? normalizeWarna(raw.warna) : null;
  const booking = raw.booking ? normalizeNominal(raw.booking) : null;
  const baterai = raw.baterai ? normalizeBaterai(raw.baterai) : null;
  const pembayaran = raw.pembayaran ? normalizePembayaran(raw.pembayaran) : null;
  const sales = raw.sales ? normalizeNamaProperCase(raw.sales) : null;

  const fields = { spk_an, stnk, type, warna, booking, baterai, pembayaran, sales };
  const missing: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === "" || (typeof v === "number" && v <= 0)) {
      missing.push(k);
    }
  }

  return { ...fields, missing };
}
