# TODO — Action Items

**Last updated:** 12 Mei 2026

---

## 🟢 BLOCKERS (status per 12 Mei 2026 sore — SEMUA RESOLVED)

- [x] **Nomor WA Bot** — `085101438585` **bisa dipakai untuk bot** (clarified Lucky). Tinggal scan QR di Evolution API instance baru.
- [x] **LLM API Key** — OpenRouter key `sk-or-v1-797e...` sudah disimpan di `.env`. Pakai `openrouter.ai/api/v1` + model `deepseek/deepseek-chat` (NLU) & `google/gemini-flash-1.5` (vision).
- [⏳] **GCP setup** — Google account access sudah ada, project `vinfast-sales-bot` belum di-create. **Bisa di-handle parallel saat Phase 1 development**, tidak block Phase 0.

---

## Phase 0 — Setup Infra (Minggu 1)

### Foundation
- [ ] Buat folder repo di VPS: `/opt/vinfast-bot/`
- [ ] Setup `git init` + `.gitignore`
- [ ] Generate `package.json` dengan dependencies (express, drizzle-orm, openai, bullmq, ioredis, pino, zod, axios, exceljs, googleapis, @google-cloud/documentai)
- [ ] Generate `tsconfig.json`, `drizzle.config.ts`
- [ ] Generate `Dockerfile` + `docker/docker-compose.yml`
- [ ] Generate `.env.example`

### Auth & Token Setup
- [ ] CLI `auth:sharepoint` — device code flow untuk dapat token SharePoint
- [ ] CLI `auth:test` — verifikasi SharePoint token dengan curl `/sites/VinFast/_api/web`
- [ ] Token refresh logic di `src/services/sharepoint-auth.ts`
- [ ] Auto-renewal cron (daily check, refresh jika <10 hari lagi expired)

### Database
- [ ] Drizzle schema lengkap: users, roles, permissions, role_permissions, customer, spk, stok, ompang_tracking, payment, message_log, llm_call_log, audit_log, etl_state
- [ ] Migration `0001_init.sql` + `0002_seed_master.sql`
- [ ] Seed 27 karyawan dari DB_HR sebagai users (default role = sales_executive)
- [ ] Seed enum master: dealers, tipe_mobil, warna, leasing, payment_types

### Google Workspace Setup (perlu akses automobilvinfast@gmail.com)
- [ ] Buat GCP project `vinfast-sales-bot`
- [ ] Enable API: Sheets API, Drive API, Document AI API
- [ ] Create service account `bot-sa@vinfast-sales-bot.iam.gserviceaccount.com`
- [ ] Download JSON key → `credentials/google-sa.json`
- [ ] Buat Google Drive folder `SalesBot/` + subfolders (SPK, Templates, Archive, Reports)
- [ ] Share `SalesBot/` ke service account sebagai Editor
- [ ] Buat Google Sheet `SalesBot_Inbox` dengan 6 tabs (Inbox_SPK_Bot, Inbox_KTP_Bot, Inbox_KK_Bot, Inbox_Payment_Bot, Log_Bot, Stats_Daily)
- [ ] Share spreadsheet ke service account sebagai Editor
- [ ] Setup Document AI processor: KTP Indonesia parser + Generic Form parser
- [ ] CLI `seed:gsheets` untuk auto-create headers di tiap tab

### Evolution API Instance
- [ ] Akses Evolution API admin panel atau API
- [ ] POST `/instance/create` dengan name `vinfast-bot`
- [ ] Scan QR code di console Evolution untuk pair nomor bot
- [ ] Set webhook URL: `https://vinfast.caricreatormu.my.id/webhook/wa`
- [ ] Test send/receive message

### Domain & SSL
- [ ] Verify DNS A record `vinfast.caricreatormu.my.id → 109.123.240.168`
- [ ] Issue Let's Encrypt cert via certbot
- [ ] Tambah nginx server block ke `evolution_nginx`
- [ ] Reload nginx
- [ ] Test HTTPS endpoint

### LLM via OpenRouter
- [x] ~~Generate API key~~ (sudah ada, di `.env`)
- [ ] Top-up balance OpenRouter (kalau belum) — minimal $5
- [ ] Implementasi `src/services/llm.ts` dengan `openai` SDK + baseURL `openrouter.ai/api/v1`
- [ ] Routing: `deepseek/deepseek-chat` untuk NLU, `google/gemini-flash-1.5` untuk vision/OCR
- [ ] CLI `llm:test "stok vf3 hitam"` untuk verify parsing
- [ ] Monitor cost via OpenRouter dashboard + WA alert harian

### Acceptance Phase 0
- [ ] Bot terima pesan WA "ping" → balas "pong"
- [ ] `curl /health` return 200
- [ ] Sync worker bisa download Jurnal Ompang.xlsx dari SharePoint
- [ ] Bisa append baris ke Google Sheets Inbox_SPK_Bot

---

## Phase 1 — MVP Core (Minggu 2-3)

### Query Engine
- [ ] Handler `query-stok` dengan regex pre-parsing + LLM fallback
- [ ] Handler `query-ompang` (by nama, by VIN, by no SPK)
- [ ] Handler `query-stnk` + `query-bpkb`
- [ ] Format reply WA yang readable di mobile (max 1600 char, gunakan emoji minimal)

### Sync Worker
- [ ] `src/workers/sync-worker.ts` dengan node-cron tiap 2 menit
- [ ] Modul `normalizers.ts` untuk semua field (tipe_mobil, dealer, warna, payment, booking_dp)
- [ ] Skip filter untuk test rows (nama < 3 char, regex test/cek/asd)
- [ ] Parse 3 file Excel: Jurnal Sales Mobil (SPK + Stock Unit + Payment), Jurnal Ompang, DB_MOBIL (master)
- [ ] UPSERT logic dengan VIN sebagai unique key
- [ ] Audit log per insert/update

### SPK Intake Conversational
- [ ] State machine di Redis dengan TTL 30 menit
- [ ] 16 field collection (sesuai SPK sheet)
- [ ] Per-field validation (NIK 16 digit, no HP format Indo, dst)
- [ ] Review summary + confirmation
- [ ] Append ke Google Sheets Inbox_SPK_Bot
- [ ] Create folder Google Drive `/SalesBot/SPK/2026/{NoSPK}/`

### User Management & RBAC
- [ ] Middleware `wa-auth.ts`
- [ ] Permission system (matrix permission per role)
- [ ] Auto-onboarding: nomor di customer table → auto-create user Customer role
- [ ] CLI `user:add`, `user:list`, `role:grant`

### Acceptance Phase 1
- [ ] Query stok jawab <3 detik dengan data benar
- [ ] Query ompang jawab dengan status STNK & BPKB
- [ ] SPK intake selesai end-to-end → row baru di Google Sheets
- [ ] Sync worker jalan tiap 2 menit, lag <5 menit

---

## Phase 2 — Document Processing (Minggu 4-5)

### OCR Pipeline
- [ ] Handler `doc-upload` deteksi caption "ktp"/"kk" atau state context
- [ ] Download image dari Evolution API
- [ ] Upload ke Google Drive folder customer
- [ ] OCR via Document AI KTP processor
- [ ] Parse hasil OCR ke structured (NIK, nama, ttl, alamat, dst)
- [ ] Validate confidence ≥85%, kalau < flag NEEDS_MANUAL_CHECK
- [ ] Append hasil ke Google Sheets Inbox_KTP_Bot

### Payment Verification
- [ ] Handler `payment-upload` untuk bukti TF
- [ ] OCR via Document AI Form Parser
- [ ] Extract: nominal, bank, rek tujuan, tgl, no ref
- [ ] Auto-match ke SPK aktif berdasarkan customer no_hp + window 24 jam
- [ ] Notif WA ke Finance dengan tombol Approve/Reject
- [ ] Update status payment

### Notification Engine
- [ ] Worker `notify-worker` listening ke event sync
- [ ] Rule: STNK status DONE → notif customer
- [ ] Rule: BPKB diterima Biro → notif sales + customer
- [ ] Rule: Faktur revisi → notif admin

---

## Phase 3 — Advanced Features (Minggu 6-8)

- [ ] Document generator (surat jalan, kwitansi, konfirmasi pesanan) dari template .docx
- [ ] LibreOffice convert docx → PDF
- [ ] Send PDF via WA + link Google Drive
- [ ] Query faktur dengan attachment PDF
- [ ] WA command `/stats` untuk admin (statistik bot usage)
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

- [ ] Cron daily backup PostgreSQL → Cloudflare R2 / Backblaze B2
- [ ] Cron weekly: archive message_log >90 hari ke Google Drive Archive
- [ ] Cron weekly: generate report user activity → kirim ke owner WA
- [ ] Monitor: SharePoint token expiry (alert 7 hari sebelum)
- [ ] Monitor: DeepSeek balance (alert <$0.50)
- [ ] Monitor: Disk space VPS (alert <20% free)
