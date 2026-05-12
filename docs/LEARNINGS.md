# Learnings — VinFast Bot Project

**Last updated:** 12 Mei 2026

Insights yang ditemukan saat discovery — wajib di-apply saat development.

---

## 1. Microsoft Auth: SharePoint REST > Microsoft Graph

**Problem:** Microsoft Graph `Sites.Read.All` membutuhkan **admin consent** di tenant `amapartner.org`. Lucky bukan admin → blocker total.

**Solution:** SharePoint OAuth scope `https://amapartner.sharepoint.com/AllSites.Read` **user-grantable** tanpa admin consent.

**Why it works:**
- Graph delegated permissions di-gate oleh tenant policy global
- SharePoint scope di-gate oleh ACL per-site — kalau user sudah punya akses ke site, dia bisa consent
- Sama-sama public client `14d82eec-204b-4c2f-b7e8-296a70dab67e` (MS Graph PowerShell)

**Implikasi:**
- Pakai **SharePoint REST API** (`/sites/{site}/_api/web/...`), BUKAN Graph API
- Endpoint berbeda, tapi sama-sama Bearer token, JSON, dan straightforward
- Excel content harus di-download sebagai .xlsx file lalu di-parse di Node.js (tidak ada Graph Excel API equivalent di SharePoint REST)

---

## 2. SharePoint REST API Quick Reference

```bash
# Base URL
BASE="https://amapartner.sharepoint.com/sites/VinFast/_api"

# Auth header
-H "Authorization: Bearer $TOKEN"
-H "Accept: application/json;odata=nometadata"

# Get site
GET $BASE/web

# List folders di path
GET $BASE/web/getfolderbyserverrelativeurl('/sites/VinFast/Shared Documents/Jurnal')/folders

# List files di path
GET $BASE/web/getfolderbyserverrelativeurl('/sites/VinFast/Shared Documents/Jurnal/Sales')/files

# Download file binary
GET $BASE/web/getfilebyserverrelativeurl('/sites/VinFast/Shared Documents/Jurnal/Sales/Jurnal Ompang.xlsx')/$value

# File metadata (untuk delta check via modified time)
GET $BASE/web/getfilebyserverrelativeurl('...')/listItemAllFields?$select=Modified,Editor/Title&$expand=Editor
```

**URL Encoding:** Path harus URL-encoded — spaces jadi `%20`. Tanda kutip single (`'`) tetap literal.

---

## 3. Token Lifecycle

| Item | Value |
|------|-------|
| Access token TTL | ~67 menit (4048-4151 detik) |
| Refresh token TTL | 90 hari (sliding window — di-extend setiap pakai) |
| Worst case | Re-login device code 1x per 90 hari |

**Refresh strategi:**
```
acquireTokenSilent() →
  jika access token expires < 5 menit → pakai refresh_token untuk dapat new pair
  jika refresh_token error → trigger re-login (kirim notif ke admin WA)
```

---

## 4. Data Quality di Excel Master — KRITIS

Data master di SharePoint **tidak ter-normalisasi**. Bot WAJIB normalize saat sync.

**Variasi yang ditemukan:**

| Field | Variasi raw | Normalisasi target |
|-------|------------|---------------------|
| Tipe mobil | `VF 3`, `VF3` (99+42=141 rows) | `VF3` |
| Tipe mobil | `VF E34`, `VFE 34`, `VFE34` | `VFE_34` |
| Dealer | `SOETA`, `Setiabudi`, `SETIABUDI`, `STBD`, `OMA`, `LASWI-SOETA` | enum: `SETIABUDI`, `PASTEUR`, `LASWI`, `SOETA`, `OMA` |
| Payment | `Cash`, `CASH`, `KREDIT`, `Credit`, `Credit CIMB`, `Kredit Adira` | enum `CASH`, `KREDIT_<BANK>` |
| Warna | `JET BLACK`, `Jet Black`, `White Black`, `Summer yellow`, `Infinity Blanc`, `URBAN MINT` | uppercase + trim |
| Booking DP | `"  5,000,000 "` (string), `5000000` (numeric), `"afsdf"` (junk!) | `numeric`, NULL kalau invalid |
| Test data | rows dengan nama `test`, `cek`, `asd`, `hhhh`, `mau mobil` | **skip pre-insert** |

**Konsekuensi:**
1. Modul `normalizers.ts` di bot **WAJIB**, bukan optional
2. DeepSeek LLM **sangat berguna** untuk handle variasi user input (e.g., user ketik "vf3" → match `VF3`)
3. Pre-sync filter: skip rows dengan nama < 3 char atau matches `^(test|cek|asd|coba)`
4. Validation di Drizzle: gunakan Postgres `CHECK` constraint + Zod schema di TypeScript

---

## 5. Struktur Excel "Live" — Header Tidak di Row 1

Sebagian besar sheet Excel di SharePoint VinFast punya:
- Row 1-5: kosong atau title/branding/merged cells
- Row 6-7: HEADER asli
- Row 7-8+: DATA

**Implikasi:** Parser harus deteksi header dinamis (scan rows pertama untuk find non-empty row dengan pattern header), BUKAN hardcode `row 1`.

**Heuristik:**
```typescript
function findHeaderRow(ws: Worksheet): number {
  for (let r = 1; r <= 10; r++) {
    const row = ws.getRow(r).values as string[];
    const nonEmpty = row.filter(v => typeof v === 'string' && v.trim().length > 3);
    if (nonEmpty.length >= 5) return r; // header biasanya punya 5+ kolom
  }
  return 1; // fallback
}
```

---

## 6. SPK Sheet = Microsoft Form Output

SPK sheet di `Jurnal Sales Mobil.xlsx` memiliki kolom:
- `Id` (Microsoft Form response ID)
- `Start time`, `Completion time` (timestamp form)
- `Email`, `Name` (form submitter — selalu admin/sales, bukan customer)
- Field SPK seperti normal

**Artinya:** SPK ini di-input via Microsoft Form yang dibikin di SharePoint. Saat bot menerima SPK via WA, opsi:
1. **Opsi A (Phase 1):** Tulis ke Google Sheets `Inbox_SPK_Bot`, admin manual copy ke SharePoint
2. **Opsi B (Phase 2):** Submit langsung ke Microsoft Form yang sama (perlu Form ID + field mapping)

**Recommendation:** Phase 1 pakai Opsi A. Phase 2 explore Form submission jika admin minta otomatisasi penuh.

---

## 7. VPS Port Allocation — Reuse Existing nginx

VPS sudah punya `evolution_nginx` di port 80/443 untuk Lunafore. **JANGAN deploy Caddy baru.**

**Solusi:** Tambah server block ke `evolution_nginx` config untuk `vinfast.caricreatormu.my.id` → reverse proxy ke bot internal port (3001).

**Alokasi port VinFast:**
| Service | Port |
|---------|------|
| Bot Express (internal) | 3001 |
| PostgreSQL VinFast | 5433 (host) |
| Redis VinFast | 6380 (host) |
| Evolution API | reuse existing 8080, create new WhatsApp instance |

**Docker network:** `vinfast-net` baru, atau attach ke `evolution_evo-net` existing untuk akses Evolution.

---

## 8. Evolution API: Multi-Instance, Bukan Multi-Container

Evolution API support multiple WhatsApp sessions dalam 1 container. **Tidak perlu deploy container Evolution kedua** untuk bot VinFast.

**Cara:**
- POST `/instance/create` ke `evolution_api` existing (perlu API key admin)
- Set instance name: `vinfast-bot`
- Scan QR code untuk pairing
- Set webhook URL ke `https://vinfast.caricreatormu.my.id/webhook/wa`

**Penghematan:** ~512MB RAM, ~1 vCPU, no extra container management.

---

## 9. Data Quality Tools

Saat sync worker jalan, audit anomalies:
- VIN duplikat di multiple SPK → flag investigation
- VIN exists di SPK tapi tidak di Stock Unit → mismatch
- Booking DP non-numeric → flag pakai original string di kolom `_raw` untuk audit
- Test rows → log ke `audit_log` dengan `source=SKIPPED_TEST_ROW`

Output report harian ke admin WA: "5 anomalies hari ini di Excel master, cek dashboard."

---

## 10. Bahasa & Tone Indonesia

- Bot harus pakai Bahasa Indonesia (mix dengan istilah teknis OK: "DP", "SPK", "VIN")
- Avoid English yang tidak natural ("Greetings, customer" → ❌)
- Sapaan WA mengikuti waktu lokal (WIB): "Selamat pagi/siang/malam"
- DeepSeek prompt harus berbahasa Indonesia untuk konsistensi parsing
