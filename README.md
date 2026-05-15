# VinFast Sales Admin Bot — v1.0

WhatsApp bot otomasi sales admin untuk **PT Otomobil Multi Artha** (4 dealer VinFast: Setiabudi, Pasteur, Laswi, Soetta).

**Owner:** Lucky Surya Haryadi · **Project:** VFB-2026-001 · **Status:** v1.0 production

---

## Apa yang dilakukan bot ini

1. **Intake SPK conversational** lewat WhatsApp — form 5 step (template → KTP pembeli → KTP STNK → bukti TF → konfirmasi), dengan OCR otomatis foto KTP/bukti TF (Gemini Flash via OpenRouter)
2. **Sync data SharePoint → PostgreSQL** — 5 file Excel di-poll otomatis, etag-gated agar hemat akses
3. **Query status dokumen** — `/stnk`, `/ompang`, `/faktur` by nama/VIN, dengan 3-state convention (diajukan → ready → done)
4. **Stats counter** — `/stats` snapshot SPK + Stok + Ompang/Faktur/STNK + DO
5. **Daily report** ke owner tiap 08:00 WIB

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node 22 + TypeScript + Hono.js |
| DB | PostgreSQL 16 (port 5433) via Drizzle ORM |
| Cache/state | Redis 7 (port 6380) |
| WA gateway | Evolution API (Baileys) |
| LLM | OpenRouter (Gemini Flash vision + DeepSeek NLU) |
| File source | Microsoft SharePoint REST (token auto-refresh) + Google Sheets API v4 |
| Edge | nginx + Let's Encrypt @ `https://vinfast.caricreatormu.my.id` |

---

## Sync jobs (schedule)

| Job | Source | Target table | Interval | Catatan |
|---|---|---|---|---|
| `sync_karyawan` | DB_HR.xlsx | `karyawan` | 24 hari | etag-gated, efektif bulanan |
| `sync_spk_leads` | Google Sheets `Leads_SPK` | `spk_leads` | 8 jam | Bot-generated leads dari `/spk` |
| `sync_spk_master` | Jurnal Sales Mobil.xlsx (sheet SPK) | `spk` | 8 jam | DELETE WHERE source='EXCEL_SYNC' + bulk insert |
| `sync_stok` | Jurnal Sales Mobil.xlsx (sheet Stock Unit) | `stok` | 8 jam | VIN di sheet `Sheet1` (Form A) → status SOLD; sisanya READY |
| `sync_ompang` | Jurnal Ompang.xlsx | `ompang_tracking` | 24 jam | Date columns sebagai TEXT (handle string "DONE") |
| `sync_do` | DOKUMEN DO.xlsx | `do_log` | 24 jam | |

Semua sync via `spDownloadFile()` di `src/services/sharepoint.ts` (token cache + auto-refresh 90 hari).

---

## WhatsApp commands

### Input data
| Command | Fungsi |
|---|---|
| `/spk` | Mulai intake SPK baru (5-step conversational) |
| `/lengkapi` | Lampirkan KTP/TF nyusul (lookup by nama/kode SPK) |
| `/setoran` | Input pembayaran lanjutan (booking-2, DP, pelunasan) — *pending* |
| `/tf <NO_SPK>` | Shortcut kirim bukti TF langsung by kode SPK — *pending* |
| `/batal` | Batalkan proses yang sedang berjalan |

### Query
| Command | Fungsi |
|---|---|
| `/stats` | Counter ringkas semua kategori (SPK, Stok, Ompang/Faktur/STNK, DO) |
| `/status [nama\|VIN]` | Ringkasan/detail dokumen lengkap |
| `/stnk [nama\|VIN]` | STNK & BPKB (no-arg → list pending) |
| `/ompang [nama\|VIN]` | Balik nama (no-arg → list pending) |
| `/faktur [nama\|VIN]` | Faktur (no-arg → list pending) |
| `/do [tipe]` | Stok ready (filter optional by tipe) |

### Sesi & bantuan
| Command | Fungsi |
|---|---|
| `/manual` | Matikan bot (mode chat manusia) |
| `/start` | Aktifkan bot kembali |
| `/help` | Tampilkan menu |

### Permission scope
- **owner / admin** — akses semua dealer
- **manager** — auto-scoped ke `karyawan.dealer`
- **sales** — wajib query, hanya boleh data customer sendiri (cek via `spk_leads.sales_wa`)

### 3-state convention (STNK / Faktur / Ompang)
| State | Logika |
|---|---|
| **Diajukan, belum jadi** | `pengajuan IS NOT NULL AND penerimaan IS NULL` |
| **Ready, belum diambil** | `penerimaan IS NOT NULL AND serah_terima IS NULL` (Faktur: `status != 'DONE'`) |
| **Done** | `serah_terima IS NOT NULL` (Faktur: `status = 'DONE'`) |

Data quality note: kolom tanggal di sheet Jurnal Ompang sering berisi string `"DONE"` alih-alih tanggal asli. Disimpan as-is (text column); pending detection tetap pakai `IS NULL`.

---

## Deploy

### Quick commands
```bash
# Stack up
cd /home/wabot/vinfast-bot/docker && docker compose up -d

# Rebuild bot setelah ubah code
cd /home/wabot/vinfast-bot/docker && docker compose up -d --build vinfast-bot

# Logs
docker logs vinfast-bot -f --tail 50

# DB shell
docker exec -it vinfast-db psql -U vinfast -d vinfast_bot

# Redis shell
docker exec -it vinfast-redis redis-cli

# Drizzle push schema
cd /home/wabot/vinfast-bot && npx drizzle-kit push --force

# Health check
curl https://vinfast.caricreatormu.my.id/health | jq
```

### Containers
| Name | Role | Port (host) |
|---|---|---|
| `vinfast-bot` | Hono + TS, webhook receiver | 3001 |
| `vinfast-db` | PostgreSQL 16 | 5433 |
| `vinfast-redis` | Redis 7 | 6380 |
| `evolution_api` | WA Baileys gateway (shared) | 8080 |
| `evolution_nginx` | HTTPS edge | 80/443 |

---

## Env vars (yang penting)

```bash
DATABASE_URL=postgresql://vinfast:...@vinfast-db:5432/vinfast_bot
REDIS_URL=redis://vinfast-redis:6379

# Evolution
EVOLUTION_BASE_URL=http://evolution_api:8080
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE_NAME=vinfast-bot
EVOLUTION_WEBHOOK_SECRET=...

# OpenRouter (LLM)
OPENROUTER_API_KEY=sk-or-...
LLM_MODEL_NLU=deepseek/deepseek-chat
LLM_MODEL_VISION=google/gemini-2.5-flash

# SharePoint
SP_TENANT_ID=...
SP_CLIENT_ID=14d82eec-204b-4c2f-b7e8-296a70dab67e
SP_TOKEN_FILE=/opt/sales-bot/credentials/sp-token.json
SP_SITE_URL=https://amapartner.sharepoint.com/sites/VinFast

# Sync intervals (ms)
SP_KARYAWAN_SYNC_INTERVAL_MS=2073600000   # 24 hari
SYNC_SPK_INTERVAL_MS=28800000             # 8 jam (Google Sheets leads)
SYNC_SPK_MASTER_INTERVAL_MS=28800000      # 8 jam
SYNC_STOK_INTERVAL_MS=28800000            # 8 jam
SYNC_OMPANG_INTERVAL_MS=86400000          # 24 jam
SYNC_DO_INTERVAL_MS=86400000              # 24 jam

# Source files
SP_OMPANG_FILE=/sites/VinFast/Shared Documents/Jurnal/Sales/Jurnal Ompang.xlsx
SP_OMPANG_SHEET=Jurnal Ompang
SP_DO_FILE=/sites/VinFast/Shared Documents/Jurnal/Sales/DOKUMEN DO.xlsx
SP_DO_SHEET=Sheet1
SP_SPK_FILE=/sites/VinFast/Shared Documents/Jurnal/Sales/Jurnal Sales Mobil.xlsx

# Google
GOOGLE_SA_KEY_FILE=/opt/sales-bot/credentials/google-sa.json
GSHEETS_INBOX_ID=1liAqMPH_IBYpzJJk8Si6zK4wZtRXOLDEg4GibxTwSrc
GDRIVE_ROOT_FOLDER_ID=14OFR6nYWrcBYsBsTqtXMBTMlw1ZKkfON

# Reporting
DAILY_REPORT_ENABLED=true   # 08:00 WIB ke role=owner
```

---

## Struktur direktori

```
src/
├── index.ts                Hono bootstrap + /health + /webhook/wa
├── config/env.ts           Zod validation semua env var
├── db/
│   ├── client.ts           Drizzle + pg pool
│   └── schema.ts           14 tabel (users, karyawan, customer, spk, spk_leads,
│                           stok, ompang_tracking, do_log, payment, message_log,
│                           llm_call_log, audit_log, etl_state, sync_state,
│                           conversation_state, roles, permissions, role_permissions)
├── handlers/               WA command handlers
│   ├── router.ts           Routing utama
│   ├── start.ts manual-mode.ts greeting.ts help.ts
│   ├── spk.ts              5-step SPK intake
│   ├── lengkapi.ts         Lampirkan KTP/TF nyusul
│   ├── setoran.ts          Pembayaran lanjutan (pending)
│   ├── stats.ts            /stats counter
│   ├── status.ts           /status /stnk /ompang /faktur
│   ├── do.ts               /do query stok
│   └── media-ocr.ts        Caption-based KTP/TF OCR routing
├── jobs/                   Background sync jobs
│   ├── scheduler.ts        Job registration + cron
│   ├── sync-karyawan.ts    DB_HR → karyawan
│   ├── sync-spk.ts         Google Sheets Leads_SPK → spk_leads
│   ├── sync-spk-master.ts  SharePoint SPK sheet → spk
│   ├── sync-stok.ts        Stock Unit sheet → stok (+ Form A SOLD detection)
│   ├── sync-ompang.ts      Jurnal Ompang → ompang_tracking
│   ├── sync-do.ts          DOKUMEN DO → do_log
│   ├── daily-report.ts     08:00 WIB report ke owner
│   └── drive-migrate.ts    Batch upload local → Google Drive (pending)
├── services/               
│   ├── sharepoint.ts       SP REST (token cache + refresh + download)
│   ├── sheets.ts           Google Sheets API (read/append/update)
│   ├── drive.ts            Google Drive API
│   ├── evolution.ts        Evolution WA wrapper
│   ├── ocr.ts              OpenRouter Gemini Flash vision
│   ├── redis.ts logger.ts session-mode.ts conv-state.ts
│   ├── spk-parser.ts       Regex + LLM fallback DeepSeek
│   ├── spk-validator.ts    Cross-validate nama/nominal/berita
│   ├── spk-counter.ts      SPK-DRAFT-YYYY-MM-NNN counter (Redis)
│   ├── media-storage.ts    25MB cap, SHA256 dedup
│   ├── media-receiver.ts   Evolution media download
│   └── karyawan.ts         User auth lookup
├── middleware/auth-wa.ts   Whitelist auth + role injection
└── routes/
    ├── webhook-wa.ts       Evolution webhook receiver
    ├── media.ts            Local /media/ preview (basicAuth)
    └── admin.ts            Admin endpoints (secret-gated)
```

---

## Notable design decisions

- **Date as TEXT untuk Ompang** — sheet Jurnal Ompang banyak isi "DONE" string di kolom date, schema disesuaikan ke TEXT (`tgl_*`). Pending detection tetap `IS NULL`.
- **Sync idempotent via DELETE + INSERT** untuk `spk_master` dan `stok` — table relatif kecil (<200 rows), simpler dari upsert dengan ambiguous keys.
- **No HMAC on webhook endpoint** — Evolution → bot lewat Docker DNS internal (`http://vinfast-bot:3001`), tidak expose ke public. Public endpoint dilindungi nginx + Evolution sendiri di-protect via API key.
- **Local file storage > Google Drive** — Service Account tidak punya storage quota. Foto disimpan di `/opt/sales-bot/uploads/{KTP,SPK,SETORAN,MISC}`, di-preview via nginx `/media/` route dengan basicAuth.
- **Daily report scope sementara owner-only** — admin + manager target di-skip dulu (akan di-enable balik nanti).

---

## Known issues (v1.0)

- `sync_karyawan` error `SP meta failed 400` — `SP_KARYAWAN_FILE` path perlu di-fix. Karyawan saat ini 35 row dari seed awal, masih fungsional untuk auth. *Deferred.*
- `ompang_tracking.dealer` belum terisi — sheet Jurnal Ompang tidak punya kolom dealer (hanya Domisili). Bisa di-join via VIN dari spk_leads/do_log kalau diperlukan. *Deferred.*
- `/setoran` dan `/tf <no_spk>` belum implement.
- Drive upload batch migrate pending (M6).

---

## Roadmap berikutnya

- M3.3: `/setoran` flow untuk pembayaran lanjutan (booking-2 / DP / pelunasan)
- M6: Drive batch migrate (upload local files → Drive)
- Daily report scope diperluas ke admin + manager per dealer
- Notification engine (rule-based: STNK done → notif customer, Faktur revisi → notif admin)
- `/tf <no_spk>` shortcut command

---

## Quick test (simulate WA from CLI)

```bash
curl -X POST http://localhost:3001/webhook/wa \
  -H "Content-Type: application/json" \
  -d '{"event":"messages.upsert","instance":"vinfast-bot","data":{
    "key":{"remoteJid":"6282218255795@s.whatsapp.net","fromMe":false,"id":"test-1"},
    "message":{"conversation":"/stats"},
    "pushName":"Test"
  }}'
```

Cek hasilnya di `message_log`:
```sql
SELECT created_at, message_text, intent, handler, status, response_time_ms
FROM message_log WHERE wa_number = '6282218255795'
ORDER BY created_at DESC LIMIT 5;
```
