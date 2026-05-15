# TODO — Action Items

**Last updated:** 13 Mei 2026

---

## ✅ Phase 0 — Setup Infra (SELESAI 13 Mei 2026)

Semua infra running. Detail di `HANDOFF.md`.

| Group | Status |
|-------|--------|
| Repo skeleton (package.json, tsconfig, Drizzle config, Hono bootstrap) | ✅ |
| Docker stack (bot + db 5433 + redis 6380 + log rotation + resource limits) | ✅ |
| SharePoint REST + token refresh | ✅ |
| Google Sheets `SalesBot_Inbox` + Drive folder | ✅ |
| OpenRouter NLU + vision tested | ✅ |
| Evolution instance `vinfast-bot` paired ke 6285101438585 | ✅ |
| Webhook `http://vinfast-bot:3001/webhook/wa` via Docker DNS | ✅ |
| Domain `https://vinfast.caricreatormu.my.id` + SSL Let's Encrypt | ✅ |
| Cert auto-renewal (daily cron via Docker certbot) | ✅ |
| `ping → pong` end-to-end test | ✅ |
| Drizzle schema push (13 tabel + 17 index) | ✅ |

---

## 🔥 Phase 1 — MVP Core (NEXT)

Prioritas urut sesuai request Lucky 13 Mei:

### 1. SPK Intake Trial
- [ ] `src/services/storage.ts` — local file upload helper
- [ ] `src/handlers/spk-intake.ts` — state machine 16 field di Redis (TTL 30 menit)
- [ ] Per-field validation (NIK 16 digit, no HP, tipe mobil enum)
- [ ] Final: append row ke Sheets `Inbox_SPK_Bot` + create folder `uploads/SPK/2026/{NoSPK}/`
- [ ] Command trigger: `spk` atau `/spk`

### 2. Karyawan Lookup
- [ ] CLI `seed:users` — download `DB_HR.xlsx` SharePoint → seed `users` table (default role sales_executive)
- [ ] `src/handlers/query-user.ts` — `cari karyawan {nama}` → SELECT FROM users LIKE
- [ ] Format reply: nama, role, dealer

### 3. Photo Upload + Parse
- [ ] `src/services/evolution-media.ts` — download media from Evolution by message_id
- [ ] `src/services/llm.ts` — OpenRouter wrapper (NLU + vision) dengan Redis cache + circuit breaker
- [ ] `src/handlers/upload-ktp.ts` — save → OCR `gemini-2.5-flash` → `customer` table + `Inbox_KTP_Bot` Sheets
- [ ] `src/handlers/upload-payment.ts` — save → OCR → auto-match SPK aktif → `payment` table + `Inbox_Payment_Bot` Sheets

### Service modules prerequisite untuk #1-3
- [ ] `src/services/sharepoint-rest.ts` — token cache + refresh + download file
- [ ] `src/services/gsheets.ts` — append + batch update
- [ ] `src/utils/normalizers.ts` — enum mapper dealer/tipe/warna, booking_dp parser, test row filter

### Sync Worker (paralel — bisa dikerjakan setelah handler atau sebelum)
- [ ] `src/workers/sharepoint-sync.ts` — poll 2 menit, parse 2 file Excel, UPSERT `spk`/`stok`/`ompang_tracking`
- [ ] MD5 hash di `etl_state` table → skip unchanged

### Query Engine (low priority, setelah sync worker)
- [ ] `src/handlers/query-stok.ts` — `stok vf3 hitam`
- [ ] `src/handlers/query-ompang.ts` — `ompang budi` / `ompang VIN-xxx`
- [ ] `src/handlers/query-stnk-bpkb.ts`

### Webhook Hardening
- [ ] `src/middleware/webhook-verify.ts` — HMAC SHA-256 verification
- [ ] `src/middleware/rate-limit.ts` — Redis sliding window 30/menit per WA number
- [ ] Insert tiap inbound message ke `message_log` table

### Acceptance Phase 1
- [ ] SPK intake end-to-end (16 field → Sheets row)
- [ ] Cari karyawan working
- [ ] KTP upload + OCR ≥85% confidence
- [ ] Bukti TF upload + auto-match SPK
- [ ] Sync worker jalan tiap 2 menit, lag <5 menit

---

## Phase 2 — Document Processing (Minggu 4-5)

### Notification Engine
- [ ] Worker `notify-worker` listen ke event sync
- [ ] Rule: STNK done → notif customer
- [ ] Rule: BPKB diterima Biro → notif sales + customer
- [ ] Rule: Faktur revisi → notif admin

### Payment Verification refinement
- [ ] Notif Finance dengan tombol Approve/Reject
- [ ] Update status payment

---

## Phase 3 — Advanced Features (Minggu 6-8)

- [ ] Document generator (surat jalan, kwitansi, konfirmasi pesanan) dari template .docx
- [ ] LibreOffice convert docx → PDF
- [ ] Send PDF via WA + link
- [ ] Query faktur dengan attachment PDF
- [ ] WA command `/stats` untuk admin
- [ ] Analytics aggregator (user_stats_daily)
- [ ] Stress test 100 concurrent users

---

## Phase 4 — Hardening & Go-Live (Minggu 9-10)

- [ ] Security audit: webhook HMAC, rate limit, input validation
- [ ] Penetration test
- [ ] Backup automation (pg_dump daily ke object storage)
- [ ] Monitoring: Uptime check + alert via WA admin
- [ ] Documentation SOP admin sales
- [ ] Training sesi per cabang (4 dealer)
- [ ] UAT 1 minggu dengan data riil
- [ ] Go-live + rollback plan

---

## Operational / Day-to-Day

- [x] SSL cert auto-renewal cron (daily 03:00)
- [ ] Cron daily backup PostgreSQL → Cloudflare R2 / Backblaze B2
- [ ] Cron weekly: archive message_log >90 hari
- [ ] Cron weekly: generate report user activity → kirim ke owner WA
- [ ] Monitor: SharePoint token expiry (alert 7 hari sebelum)
- [ ] Monitor: OpenRouter balance (alert <$0.50)
- [ ] Monitor: Disk space VPS (alert <20% free)
