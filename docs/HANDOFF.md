# Handoff Note — Phase 0 → Phase 1

**Last session:** 13 Mei 2026 — Phase 0 selesai, infrastruktur full deployed.
**Working dir:** `/home/wabot/vinfast-bot/`
**Owner:** Lucky Surya Haryadi (`Lucky@amapartner.org`, WA `082218255795`)

---

## 📦 What's Running Now

### Docker stack (di VPS `109.123.240.168`)
```
docker compose -f /home/wabot/vinfast-bot/docker/docker-compose.yml ps
```

| Container | Role | Status |
|-----------|------|--------|
| `vinfast-bot` | Hono + TS app, port 3001 | healthy |
| `vinfast-db` | Postgres 16, port 5433 (host) | healthy |
| `vinfast-redis` | Redis 7, port 6380 (host) | healthy |
| `evolution_api` | WA Baileys gateway | instance `vinfast-bot` open |
| `evolution_nginx` | HTTPS edge proxy | serves vinfast.caricreatormu.my.id |

### External endpoints
- `https://vinfast.caricreatormu.my.id/health` — JSON status (db+redis)
- `https://vinfast.caricreatormu.my.id/webhook/wa` — Evolution webhook receiver
- WA bot number: `6285101438585` (Vinfast Otomobil Multi Artha)

### Verified integrations
| Service | Status | Notes |
|---------|--------|-------|
| Google Sheets write | ✅ | `SalesBot_Inbox` ID `1liAqMPH_IBYpzJJk8Si6zK4wZtRXOLDEg4GibxTwSrc` |
| Google Drive folder create | ✅ | Root `14OFR6nYWrcBYsBsTqtXMBTMlw1ZKkfON`; **upload file gak bisa** (SA no storage) — fallback ke VPS local `/opt/sales-bot/uploads/` |
| SharePoint REST read | ✅ | Token auto-refresh (refresh_token cycle 90 hari) |
| OpenRouter NLU (deepseek-chat) | ✅ | Intent + entity extraction tested |
| OpenRouter vision (gemini-2.5-flash) | ✅ | Untuk OCR KTP/rekening/bukti TF |
| Evolution → bot webhook (Docker DNS) | ✅ | `http://vinfast-bot:3001/webhook/wa` |
| End-to-end ping → pong | ✅ | tested 13 Mei 03:43 UTC |

---

## 🎯 Phase 1 — Next Up (urut prioritas Lucky)

### A. SPK Intake Trial (paling tinggi)
- `src/handlers/spk-intake.ts` — conversational state machine di Redis TTL 30 menit, 16 field sesuai sheet SPK
- Per-field validation: NIK 16 digit, no HP Indo, tipe mobil dari enum
- Final step: append row ke Sheets `Inbox_SPK_Bot` + create folder `uploads/SPK/2026/{NoSPK}/`
- Trigger: command WA `spk` atau `/spk`

### B. Cek by Database Karyawan
- Seed `users` table dari `DB_HR.xlsx` SharePoint (27 karyawan, default role `sales_executive`)
- `src/handlers/query-user.ts` — `cari karyawan budi` / `/karyawan budi` → SELECT * FROM users WHERE LOWER(nama) LIKE '%budi%'
- Reply WA: nama, role, dealer, no_hp (kalau ada)

### C. Photo Upload + Parsing
1. **KTP** (`src/handlers/upload-ktp.ts`)
   - Download foto dari Evolution API (Bailieys media)
   - Save ke `uploads/SPK/{NoSPK}/KTP_{timestamp}.jpg` (atau folder ad-hoc kalau intake context belum ada)
   - OCR via OpenRouter `gemini-2.5-flash` (prompt structured JSON output)
   - Fields: NIK, nama, ttl, alamat, RT/RW, kel, kec, kab, prov, agama, status_kawin, pekerjaan, confidence
   - Append ke `Inbox_KTP_Bot` Sheets + insert ke `customer` table

2. **Rekening / Bukti TF** (`src/handlers/upload-payment.ts`)
   - Save ke `uploads/SPK/{NoSPK}/TF_{timestamp}.jpg`
   - OCR vision → JSON: bank_pengirim, nama_pengirim, nominal, tgl_transfer, no_ref, rek_tujuan
   - Auto-match ke SPK aktif (customer no_hp + window 24h) → status `MATCHED` atau `NEEDS_REVIEW`
   - Notif Finance via WA (kalau Finance role di users sudah ada)

### Service modules yang harus dibuat dulu (dependency untuk A/B/C)
- `src/services/sharepoint-rest.ts` — auto-refresh wrapper + download by path
- `src/services/llm.ts` — OpenRouter client (NLU + vision), Redis cache, circuit breaker
- `src/services/gsheets.ts` — append row, batch update
- `src/services/storage.ts` — local file upload + url generator
- `src/services/evolution-media.ts` — download media dari Evolution by message_id
- `src/utils/normalizers.ts` — enum mapper, booking_dp parser, test row filter

### Sync worker (parallel — bisa setelah A/B/C atau bareng)
- `src/workers/sharepoint-sync.ts` — poll setiap 2 menit, parse 2 file Excel, UPSERT ke `spk`/`stok`/`ompang_tracking`
- MD5 hash di `etl_state` untuk skip kalau unchanged

---

## 🔑 Key Files & Config

```
/home/wabot/vinfast-bot/
├── .env                        ← semua secret + path (di gitignore)
├── credentials/
│   ├── google-sa.json          ← chmod 600, SA: vinfast-bot-sa@vinfast-sales-admin.iam.gserviceaccount.com
│   ├── sp-token.json           ← auto-refresh (Lucky's MS account)
│   └── graph-token.json        ← backup, unused
├── docs/
│   ├── ARCHITECTURE.md         ← v1.3 final
│   ├── LEARNINGS.md            ← data quality issues, Excel header heuristic
│   ├── TODO.md                 ← checklist Phase 0-4
│   └── HANDOFF.md              ← file ini
├── src/
│   ├── index.ts                ← Hono bootstrap + /health + /webhook/wa (ping/pong only)
│   ├── config/env.ts           ← Zod validation semua env var
│   ├── services/
│   │   ├── logger.ts           ← Pino + redact secrets
│   │   ├── redis.ts            ← ioredis client
│   │   └── evolution.ts        ← WA send wrapper (sendText + normalizeJid)
│   └── db/
│       ├── client.ts           ← Drizzle + pg pool
│       └── schema.ts           ← 13 tabel (roles, users, customer, spk, stok, ompang_tracking, payment, message_log, llm_call_log, audit_log, etl_state, conversation_state, permissions, role_permissions)
├── docker/docker-compose.yml   ← stack production
├── Dockerfile                  ← multi-stage Node 22
├── scripts/cert-renew.sh       ← daily 03:00 cron (sudah terpasang)
└── letsencrypt/config/         ← cert vinfast.caricreatormu.my.id (expire 11 Agu 2026)
```

---

## 🚨 Constraints — Jangan Lupa

1. **SharePoint REST scope `AllSites.Read`** (BUKAN Graph `Sites.Read.All` — admin consent di-block tenant)
2. **OpenRouter** (BUKAN DeepSeek direct, BUKAN Google Document AI) — satu key untuk multi-model
3. **VPS local storage** untuk file uploads (SA Google Drive no storage quota)
4. **nginx existing** (`evolution_nginx`) — JANGAN deploy nginx baru. Server block di `/home/wabot/evolution/nginx/conf.d/vinfast.conf`
5. **Evolution instance existing** (`vinfast-bot`) — JANGAN create instance baru
6. **Port mapping**:
   - vinfast-db: 5433 host (5432 dipakai atria-db)
   - vinfast-redis: 6380 host (6379 dipakai evolution_redis)
   - vinfast-bot: 3001
7. **Data quality** Excel buruk → `normalizers.ts` mandatory. Lihat `docs/LEARNINGS.md` section 4.
8. **DB password** di `docker/.env` (DB_PASSWORD=vinfastdb2026) — sama dengan `../.env` (DATABASE_URL)

---

## 🛠 Quick Commands

```bash
# Health
curl https://vinfast.caricreatormu.my.id/health | jq

# Bot logs
docker logs vinfast-bot -f --tail 50

# WA connection state
EVO_KEY=b97deb0eedd6d6e62025663e7320e3c4dac18752b090724560e9fed4a6aecd95
curl -s -H "apikey: $EVO_KEY" http://localhost:8080/instance/connectionState/vinfast-bot | jq

# DB shell
docker exec -it vinfast-db psql -U vinfast -d vinfast_bot

# Redis shell
docker exec -it vinfast-redis redis-cli

# Restart bot setelah update code
cd /home/wabot/vinfast-bot/docker && docker compose up -d --build vinfast-bot

# DB schema push setelah edit src/db/schema.ts
cd /home/wabot/vinfast-bot && npx drizzle-kit push --force

# Test webhook locally (simulate WA message)
curl -X POST http://localhost:3001/webhook/wa -H "Content-Type: application/json" \
  -d '{"event":"messages.upsert","data":{"key":{"remoteJid":"6282218255795@s.whatsapp.net","fromMe":false},"message":{"conversation":"ping"},"pushName":"Test"}}'
```

---

## 📝 Style notes untuk Lucky

- Suka **production-ready code dari awal**, bukan stub
- Bahasa Indonesia campur teknis, langsung ke point
- Jangan over-engineer. Jangan tanya ulang yang sudah pasti.
- Sebelum implement: check `docs/LEARNINGS.md` + `docs/ARCHITECTURE.md` + memory `project_vinfast_bot.md`

---

## 🔢 Test Numbers
- **Bot**: `6285101438585` (Vinfast Otomobil Multi Artha)
- **Lucky** (untuk test): `6282218255795`
- **Raisha** (rencana test berikutnya): `628112202304`
