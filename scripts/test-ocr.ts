import { parseKtp, parseBuktiTf } from "../src/services/ocr.js";
import { saveMedia } from "../src/services/media-storage.js";
import { promises as fs } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const mode = argv[0];
const filePath = argv[1];

if (!mode || !filePath) {
  console.log("Usage: tsx scripts/test-ocr.ts <ktp|tf> <path-to-image>");
  process.exit(1);
}

const buf = await fs.readFile(filePath);
const ext = path.extname(filePath).slice(1).toLowerCase();
const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

const saved = await saveMedia({
  category: mode === "ktp" ? "KTP" : "SETORAN",
  subfolder: "test",
  base64: buf.toString("base64"),
  mimeType,
  label: mode.toUpperCase(),
});

console.log("Saved :", saved.relPath);
console.log("Preview:", saved.previewUrl);
console.log("Size   :", (saved.sizeBytes / 1024).toFixed(1), "KB");
console.log("---");

const result =
  mode === "ktp"
    ? await parseKtp(saved.absPath, mimeType)
    : await parseBuktiTf(saved.absPath, mimeType);

console.log(JSON.stringify(result, null, 2));
