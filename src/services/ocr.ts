import OpenAI from "openai";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { promises as fs } from "node:fs";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.OPENROUTER_BASE_URL,
});

export interface KtpData {
  nik: string | null;
  nama: string | null;
  tempat_lahir: string | null;
  tgl_lahir: string | null;
  jenis_kelamin: "LAKI-LAKI" | "PEREMPUAN" | null;
  alamat: string | null;
  rt_rw: string | null;
  kelurahan: string | null;
  kecamatan: string | null;
  kabupaten: string | null;
  provinsi: string | null;
  agama: string | null;
  status_kawin: string | null;
  pekerjaan: string | null;
  kewarganegaraan: string | null;
  berlaku_hingga: string | null;
  confidence: number;
}

export interface BuktiTfData {
  bank: string | null;
  nominal: number | null;
  tgl_transfer: string | null;
  jam_transfer: string | null;
  nama_pengirim: string | null;
  rekening_pengirim: string | null;
  nama_penerima: string | null;
  rekening_penerima: string | null;
  berita: string | null;
  no_referensi: string | null;
  confidence: number;
}

function cleanJson(text: string): string {
  // Remove markdown code blocks if present
  let cleaned = text.replace(/```json\s*|```\s*/g, "").trim();
  
  // If there's still something before the first '{' or after the last '}', trim it
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }
  return cleaned;
}

async function visionExtract<T>(opts: {
  absPath: string;
  mimeType: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<T> {
  const buf = await fs.readFile(opts.absPath);
  const b64 = buf.toString("base64");
  const t0 = Date.now();

  const resp = await client.chat.completions.create({
    model: env.LLM_MODEL_VISION,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: opts.userPrompt },
          { type: "image_url", image_url: { url: `data:${opts.mimeType};base64,${b64}` } },
        ],
      },
    ],
    temperature: 0,
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  const cleaned = cleanJson(raw);

  try {
    const parsed = JSON.parse(cleaned) as T;
    logger.info({ model: env.LLM_MODEL_VISION, ms: Date.now() - t0 }, "ocr.vision.ok");
    return parsed;
  } catch (err) {
    logger.error({
      model: env.LLM_MODEL_VISION,
      raw,
      cleaned,
      msg: (err as Error).message
    }, "ocr.vision.parse.failed");
    throw new Error(`Failed to parse OCR response: ${(err as Error).message}`);
  }
}

export async function parseKtp(absPath: string, mimeType: string): Promise<KtpData> {
  return visionExtract<KtpData>({
    absPath,
    mimeType,
    systemPrompt: 
      "You are an Indonesian KTP (e-KTP) data extractor. Return strictly valid JSON. Use null for any field you cannot read with high confidence.",
    userPrompt: `Extract ALL fields from this Indonesian KTP. Return JSON with keys:
nik, nama, tempat_lahir, tgl_lahir (DD-MM-YYYY), jenis_kelamin (LAKI-LAKI or PEREMPUAN), alamat, rt_rw, kelurahan, kecamatan, kabupaten, provinsi, agama, status_kawin, pekerjaan, kewarganegaraan, berlaku_hingga, confidence (0-1).
NIK must be 16 digits. If image is not a KTP, set all fields null and confidence=0.`,
  });
}

export async function parseBuktiTf(absPath: string, mimeType: string): Promise<BuktiTfData> {
  return visionExtract<BuktiTfData>({
    absPath,
    mimeType,
    systemPrompt: 
      "You are a bank transfer receipt extractor. Return strictly valid JSON. Use null for unreadable fields.",
    userPrompt: `Extract from this Indonesian bank transfer proof image. Return JSON:
bank (BCA/Mandiri/BNI/BRI/etc), nominal (integer rupiah, no formatting), tgl_transfer (YYYY-MM-DD), jam_transfer (HH:MM:SS), nama_pengirim, rekening_pengirim, nama_penerima, rekening_penerima, berita (note/description field), no_referensi, confidence (0-1).
If not a transfer receipt, all null and confidence=0.`,
  });
}
