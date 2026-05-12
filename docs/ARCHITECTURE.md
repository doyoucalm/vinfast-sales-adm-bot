# Architecture — Feasible & Realistic (per 12 Mei 2026)

**Status:** Locked design based on real VPS state + auth constraints + data findings.
**Sumber konfirmasi:** Live curl SharePoint REST API, `docker ps`, parsing 3 file Excel master.

---

## Constraint Reality

| Konstrain | Implikasi Desain |
|-----------|------------------|
| Lucky bukan admin tenant amapartner.org | Pakai SharePoint REST scope `AllSites.Read` (user-grantable) |
| Port 80/443 dipakai `evolution_nginx` | Pakai nginx existing, jangan Caddy |
| Port 5432 dipakai `atria-db` | PostgreSQL VinFast di 5433 |
| Evolution API existing di port 8080 | Buat instance baru di container yang sama |
| Excel master data berantakan | Normalizer + LLM mutlak |
| 8GB RAM, 4 vCPU, 100GB disk | Hemat: 1 PostgreSQL baru + 1 Redis baru OK |

---

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     USERS (WhatsApp)                            │
│   Customer · Sales (40+) · Admin Sales · Finance · Super Admin  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WhatsApp Protocol
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│   evolution_api (Docker, existing, port 8080)                   │
│   Instance: 'vinfast-bot' (NEW — di-create via POST /instance)  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Webhook POST → http://vinfast-bot:3001/webhook/wa
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│   evolution_nginx (existing) — TLS termination                  │
│   Server block: vinfast.caricreatormu.my.id → vinfast-bot:3001  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│   vinfast-bot (Node.js 22 + TypeScript) — port 3001 internal    │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │ Middleware:  WA auth · webhook HMAC · rate limit          │  │
│   ├──────────────────────────────────────────────────────────┤  │
│   │ LLM Preprocessor (DeepSeek deepseek-chat)                 │  │
│   │   → {intent, entities, cleaned_text, confidence}          │  │
│   │   → Fallback regex jika circuit breaker open              │  │
│   ├──────────────────────────────────────────────────────────┤  │
│   │ Handlers:                                                 │  │
│   │   spk-intake · query-stok · query-ompang · query-stnk     │  │
│   │   doc-upload (KTP/KK) · payment-upload · notification     │  │
│   │   stats · help · onboarding                               │  │
│   ├──────────────────────────────────────────────────────────┤  │
│   │ Services:                                                 │  │
│   │   sharepoint-rest (READ) · gdrive (WRITE) · gsheets       │  │
│   │   docai-ocr · deepseek-llm · postgres · redis · evolution │  │
│   └──────────────────────────────────────────────────────────┘  │
└──────┬─────────────────┬────────────────┬───────────────────────┘
       │                 │                │
       ▼                 ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│ PostgreSQL   │  │ Redis 7      │  │ External APIs            │
│ 16 (5433)    │  │ (6380)       │  │ - sharepoint REST (R)    │
│ vinfast-db   │  │ vinfast-redis│  │ - DeepSeek (LLM)         │
│              │  │              │  │ - Google Drive (W)       │
│ Tables:      │  │ - conv state │  │ - Google Sheets (W)      │
│ users/roles  │  │ - rate limit │  │ - Google Document AI     │
│ spk/customer │  │ - LLM cache  │  │ - Evolution API (WA)     │
│ stok/ompang  │  │ - circuit st │  │                          │
│ payment      │  │ - BullMQ     │  │                          │
│ message_log  │  └──────────────┘  └──────────────────────────┘
│ llm_call_log │
│ audit_log    │
└──────────────┘
       ▲
       │ Sync (poll 2-5 min)
       │
┌──────┴────────────────┐    ┌────────────────────────────────────┐
│ sync-worker (PM2)     │───▶│ SharePoint VinFast (READ-only)     │
│ Download .xlsx via    │    │ /sites/VinFast/Shared Documents/   │
│ REST → parse openpyxl │    │  Jurnal/Sales/                     │
│ → normalize → UPSERT  │    │   - Jurnal Sales Mobil.xlsx        │
│                       │    │   - Jurnal Ompang.xlsx             │
└───────────────────────┘    │   - DOKUMEN DO.xlsx                │
                             │  CORE DATABASE/Operational/        │
                             │   - DB_MOBIL.xlsx (master)         │
                             └────────────────────────────────────┘

                             ┌────────────────────────────────────┐
                             │ Google Workspace (WRITE)           │
                             │ automobilvinfast@gmail.com         │
                             │ Service Account: bot-sa@...        │
                             │                                    │
                             │ Drive: /SalesBot/                  │
                             │   ├── SPK/2026/{NoSPK}/            │
                             │   ├── Templates/                   │
                             │   └── Archive/                     │
                             │                                    │
                             │ Sheets: SalesBot_Inbox             │
                             │   ├── Inbox_SPK_Bot                │
                             │   ├── Inbox_KTP_Bot                │
                             │   ├── Inbox_Payment_Bot            │
                             │   ├── Log_Bot                      │
                             │   └── Stats_Daily                  │
                             └────────────────────────────────────┘
```

---

## Data Flow Skenarios

### A. Sales Query Stok via WA

```
1. Sales: "stok vf3 hitam ada brp?"
2. Evolution → webhook /webhook/wa
3. Middleware: lookup user → role=sales, allowed
4. LLM preprocessor (DeepSeek): 
   → {intent: 'query_stok', entities: {tipe: 'VF3', warna: 'JET BLACK'}}
5. Handler query-stok:
   SELECT lokasi, count(*) FROM stok 
   WHERE tipe_mobil = 'VF3' AND warna ILIKE '%JET BLACK%' AND status = 'READY'
   GROUP BY lokasi
6. Format response:
   "VF3 Jet Black ready:
    - Vinfast Setiabudi: 0 unit
    - Vinfast Soetta: 2 unit
    - PT OMA Gudang: 1 unit
    Total: 3 unit"
7. Bot send WA via Evolution API
8. Log ke message_log + access_log

Target latency: <3 detik (P95)
```

### B. SPK Intake Conversational

```
1. Sales: "/spk"
2. Bot: "Mulai input SPK. Nama lengkap pembeli (sesuai KTP)?"
3. State Redis: { step: 'nama_pembeli', spk_draft: {} }
4. Sales: "Budi Santoso"
5. Bot: "Type mobil? (VF3 / VF5 / VF6 / VF7 / VFE 34 / Limo)"
6. ... loop sampai semua field terisi (16 field)
7. Bot review: kirim ringkasan + button "Confirm" / "Edit"
8. Confirm:
   - Generate no_spk draft: "SPK-DRAFT-2026-05-XXX"
   - Append ke Google Sheets Inbox_SPK_Bot
   - Create folder Google Drive /SalesBot/SPK/2026/{NoSPK}/
   - Set state Redis: { step: 'awaiting_docs', spk_id: ... }
   - Reply: "SPK draft tersimpan. Mohon kirim foto KTP pembeli."
```

### C. Document OCR Flow

```
1. Sales kirim foto KTP via WA
2. Evolution capture image → webhook
3. Bot detect:
   - Caption mengandung "ktp" / "kk" / "tf"
   - ATAU state Redis = 'awaiting_docs'
4. Download image dari Evolution media endpoint
5. Upload ke Google Drive: /SalesBot/SPK/2026/{NoSPK}/KTP_{timestamp}.jpg
6. OCR via Google Document AI (KTP Indonesia parser)
   → {NIK, nama, ttl, alamat, ...}
7. Validate: NIK 16 digit, format ok
8. Append ke Google Sheets Inbox_KTP_Bot
9. Update conversation state
10. Reply: "✅ KTP diterima. Data: NIK 3273XXXXXXXXX001, BUDI SANTOSO, Jakarta. Lanjut foto KK?"
```

### D. SharePoint Sync (Background Worker)

```
Cron tiap 2 menit:
  for each file in [Jurnal Sales Mobil.xlsx, Jurnal Ompang.xlsx, DB_MOBIL.xlsx]:
    1. GET /_api/web/.../listItemAllFields?$select=Modified
    2. Compare dengan etl_state.last_modified[file]
    3. Jika sama → skip
    4. Jika beda → download .xlsx via /$value
    5. Parse semua sheet relevan:
       - SPK sheet → UPSERT ke table spk
       - Stock Unit → UPSERT ke table stok
       - Jurnal Pembayaran → UPSERT ke table payment
    6. Normalize tiap row sebelum insert
    7. Track changes via audit_log + emit notification events
    8. Update etl_state.last_modified[file]
```

---

## Schema PostgreSQL (Core Tables)

```sql
-- Users & Auth
CREATE TABLE roles (id SERIAL PRIMARY KEY, code TEXT UNIQUE, name TEXT);
CREATE TABLE permissions (id SERIAL PRIMARY KEY, code TEXT UNIQUE, desc TEXT);
CREATE TABLE role_permissions (role_id INT, permission_id INT, PRIMARY KEY (role_id, permission_id));
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  no_hp VARCHAR(20) UNIQUE NOT NULL,
  nama TEXT, email TEXT,
  role_id INT REFERENCES roles(id),
  dealer TEXT,           -- SETIABUDI/PASTEUR/LASWI/SOETA/OMA
  status TEXT DEFAULT 'active',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Business
CREATE TABLE customer (
  id SERIAL PRIMARY KEY,
  nik VARCHAR(16) UNIQUE,
  nama_pembeli TEXT, nama_stnk TEXT,
  nik_stnk VARCHAR(16),
  email TEXT, no_hp TEXT, alamat TEXT,
  npwp TEXT,
  source TEXT,           -- 'SPK_SYNC'/'WA_BOT'/'MANUAL'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE spk (
  id SERIAL PRIMARY KEY,
  form_id INT,           -- Microsoft Form Id
  no_spk TEXT UNIQUE,
  tgl_pengajuan DATE,
  dealer TEXT CHECK (dealer IN ('SETIABUDI','PASTEUR','LASWI','SOETA','OMA')),
  customer_id INT REFERENCES customer(id),
  tipe_mobil TEXT,
  warna TEXT,
  tipe_baterai TEXT,
  vin VARCHAR(17),
  payment_type TEXT,
  harga_otr NUMERIC,
  booking_dp NUMERIC,
  booking_dp_raw TEXT,   -- original string sebelum parse
  sales_name TEXT,
  status TEXT,
  source TEXT DEFAULT 'EXCEL_SYNC',  -- 'EXCEL_SYNC'/'WA_BOT'
  raw_row JSONB,         -- full original Excel row untuk debugging
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_spk_vin ON spk(vin);
CREATE INDEX idx_spk_dealer_status ON spk(dealer, status);

CREATE TABLE stok (
  id SERIAL PRIMARY KEY,
  vin VARCHAR(17) UNIQUE,
  no_mesin TEXT,
  tipe_mobil TEXT,
  warna TEXT,
  tipe_baterai TEXT,
  lokasi TEXT,           -- normalized: SETIABUDI/PASTEUR/LASWI/SOETA/OMA
  status TEXT,           -- READY/BOOKED/SOLD
  umur_hari INT,
  raw_row JSONB,
  last_synced TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ompang_tracking (
  id SERIAL PRIMARY KEY,
  vin VARCHAR(17),
  nama_stnk TEXT,
  tipe_mobil TEXT,
  payment TEXT,
  domisili TEXT,
  tgl_pengajuan_ompang DATE,
  tgl_penerimaan_ompang DATE,
  tgl_serah_terima_ompang DATE,
  tgl_pengajuan_faktur DATE,
  tgl_penerimaan_faktur DATE,
  status_faktur TEXT,
  tgl_pengajuan_stnk_bpkb DATE,
  no_surat_pengajuan TEXT,
  tgl_penerimaan_stnk DATE,
  no_surat_penerimaan_stnk TEXT,
  tgl_serah_terima_stnk DATE,
  no_surat_serah_stnk TEXT,
  tgl_penerimaan_bpkb_biro DATE,
  tgl_serah_terima_bpkb DATE,
  no_surat_serah_bpkb TEXT,
  no_invoice TEXT,
  nominal_payment NUMERIC,
  raw_row JSONB,
  last_synced TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ompang_vin ON ompang_tracking(vin);

CREATE TABLE payment (
  id SERIAL PRIMARY KEY,
  spk_id INT REFERENCES spk(id),
  jenis TEXT,            -- BOOKING_DP/DP/CICILAN_N/PELUNASAN
  nominal NUMERIC,
  tgl_transfer TIMESTAMP,
  bank_pengirim TEXT,
  rek_tujuan TEXT,
  no_ref TEXT,
  bukti_tf_url TEXT,
  ocr_data JSONB,
  status TEXT,           -- PENDING/VERIFIED/REJECTED
  verified_by INT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Operational
CREATE TABLE message_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INT,
  wa_number TEXT,
  direction TEXT,
  message_text TEXT,
  intent TEXT,
  confidence NUMERIC,
  entities JSONB,
  handler TEXT,
  response_time_ms INT,
  llm_used BOOLEAN DEFAULT false,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE llm_call_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INT,
  input_text TEXT,
  output_json JSONB,
  model TEXT,
  tokens_input INT, tokens_output INT,
  cost_usd NUMERIC(10,6),
  latency_ms INT,
  cache_hit BOOLEAN DEFAULT false,
  is_off_peak BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT,
  record_id TEXT,
  action TEXT,
  old_value JSONB, new_value JSONB,
  source TEXT,           -- EXCEL_SYNC/WA_BOT/MANUAL/CLI
  user_id INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE etl_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Docker Compose Stack

```yaml
# docker/docker-compose.yml
services:
  vinfast-bot:
    build: ../
    container_name: vinfast-bot
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3001"
    env_file: ../.env
    volumes:
      - ../credentials:/opt/sales-bot/credentials:ro
      - ../logs:/opt/sales-bot/logs
    depends_on:
      - vinfast-db
      - vinfast-redis
    networks:
      - vinfast-net
      - evolution_evo-net  # untuk akses ke evolution_api

  vinfast-db:
    image: postgres:16-alpine
    container_name: vinfast-db
    restart: unless-stopped
    ports:
      - "127.0.0.1:5433:5432"
    environment:
      POSTGRES_DB: vinfast_bot
      POSTGRES_USER: vinfast
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - vinfast-db-data:/var/lib/postgresql/data
    networks: [vinfast-net]

  vinfast-redis:
    image: redis:7-alpine
    container_name: vinfast-redis
    restart: unless-stopped
    ports:
      - "127.0.0.1:6380:6379"
    volumes:
      - vinfast-redis-data:/data
    networks: [vinfast-net]

volumes:
  vinfast-db-data:
  vinfast-redis-data:

networks:
  vinfast-net:
    driver: bridge
  evolution_evo-net:
    external: true
```

---

## nginx Server Block (tambahan ke evolution_nginx)

```nginx
# /etc/nginx/conf.d/vinfast.conf di dalam container evolution_nginx
server {
    listen 443 ssl http2;
    server_name vinfast.caricreatormu.my.id;

    ssl_certificate     /etc/letsencrypt/live/vinfast.caricreatormu.my.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vinfast.caricreatormu.my.id/privkey.pem;

    location / {
        proxy_pass http://vinfast-bot:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name vinfast.caricreatormu.my.id;
    return 301 https://$server_name$request_uri;
}
```

SSL via certbot (Let's Encrypt). Renewal otomatis 60 hari.

---

## Tech Decisions Summary

| Decision | Rationale |
|----------|-----------|
| SharePoint REST API (bukan Graph) | Tidak butuh admin consent |
| Download .xlsx + parse di Node | SharePoint REST tidak punya Excel API |
| nginx reuse (bukan Caddy baru) | Port 80/443 sudah dipakai, hindari konflik |
| Evolution instance baru (bukan container baru) | Hemat RAM, reuse infrastructure |
| PostgreSQL 16 baru di 5433 | Isolasi data dari Atria |
| Redis 7 baru di 6380 | Isolasi state |
| DeepSeek LLM | Murah ($1/bulan), Bahasa Indonesia OK, off-peak discount |
| Google Drive/Sheets WRITE side | Zero admin friction, free tier cukup |
| Document AI OCR | Akurasi tinggi KTP Indonesia |
| Drizzle ORM | Type-safe, migration friendly |
| BullMQ queue | OCR & notification async, retry handling |
| PM2 multi-process | Webhook + sync worker + notify worker dalam 1 container |
