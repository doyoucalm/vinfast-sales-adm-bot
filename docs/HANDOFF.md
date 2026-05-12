# Handoff Note — untuk Sesi Sonnet Berikutnya

**Dari:** Sesi 12 Mei 2026 (Phase 0 — Discovery)
**Untuk:** Whoever Sonnet yang lanjut kerja project ini next
**Repo:** github.com/doyoucalm/vinfast-sales-adm-bot (private)
**Working dir:** `/home/wabot/vinfast-bot/`

---

## 👋 Selamat datang. Baca ini dulu sebelum ngapa-ngapain.

User: **Lucky Surya Haryadi** — pemilik PT Otomobil Multi Artha, dealer VinFast (4 cabang).
Style komunikasi: campur Indonesia + istilah teknis, suka langsung ke point, tidak suka jawaban panjang.

---

## 📍 State Project Saat Ini

**Phase 0 — Discovery** ✅ selesai. Siap masuk Phase 0 — Setup Infra / Phase 1 — MVP Core.

Yang sudah pasti dan **JANGAN dipertanyakan ulang**:
- Auth Microsoft pakai **SharePoint REST scope `AllSites.Read`** (BUKAN Graph API `Sites.Read.All`). Sudah di-test, jalan tanpa admin consent.
- LLM pakai **OpenRouter** (`sk-or-v1-...` di `.env`), model `deepseek/deepseek-chat` untuk NLU, `google/gemini-flash-1.5` untuk vision/OCR. Sudah ada key.
- VPS production sudah ada di `109.123.240.168`, Ubuntu 24.04, port 80/443/5432/8000/8080 dipakai → bot pakai 3001/5433/6380.
- nginx existing (`evolution_nginx`) — JANGAN deploy Caddy baru, tambah server block ke nginx existing.
- Evolution API existing — buat instance baru di container yang sama, bukan deploy Evolution container baru.
- Data quality di Excel master BURUK → normalizer mutlak (lihat `docs/LEARNINGS.md` section 4).

---

## 🎯 Yang Harus Dikerjakan Berikutnya

**Prioritas urut:**

### Step 1 — Generate Repo Skeleton (1-2 sesi kerja)
Belum ada source code sama sekali. User akan minta generate full skeleton:
- `package.json` dengan dependencies
- `tsconfig.json`, `drizzle.config.ts`
- `src/index.ts` (Express bootstrap)
- `src/db/schema.ts` (Drizzle) — schema sudah ada di `docs/ARCHITECTURE.md`
- `src/services/sharepoint-rest.ts` (READ-only client)
- `src/services/llm.ts` (OpenRouter wrapper)
- `src/services/evolution.ts` (WA gateway)
- `src/services/postgres.ts`, `src/services/redis.ts`
- `Dockerfile`, `docker/docker-compose.yml`
- `nginx/vinfast.conf` (server block)

User suka **production-ready code dari awal**, bukan stub-stub kosong. Tapi jangan over-engineer.

### Step 2 — Implement Sync Worker
Modul `src/workers/sharepoint-sync.ts` — download .xlsx via SharePoint REST, parse pakai `exceljs`, normalize, UPSERT ke PostgreSQL.

**Penting:** header Excel TIDAK di row 1. Pakai `findHeaderRow()` heuristik dari `docs/LEARNINGS.md` section 5.

### Step 3 — Query Engine
Handler `query-stok`, `query-ompang`, `query-stnk-bpkb` dengan flow:
1. Regex pre-parse untuk command yang jelas (`stok vf3 hitam`)
2. Kalau ambigu → forward ke LLM
3. Query PostgreSQL
4. Format reply WA

### Step 4 — SPK Intake Conversational
State machine di Redis, 16 field, kirim ke Google Sheets (perlu GCP setup dulu).

---

## ⚠️ Hal-Hal yang Sering Bikin Salah

1. **Tipe mobil di Excel tidak konsisten** — `VF 3`/`VF3`/`VF E34`/`VFE 34`. SELALU pakai `normalizers.ts` sebelum query/insert.
2. **Booking DP kadang string `"  5,000,000 "` kadang numeric** — parse defensive, simpan raw di kolom `_raw` JSONB.
3. **Header Excel ada di row 6-7**, bukan row 1.
4. **Token SharePoint refresh manual** — refresh token sliding 90 hari. Auto-renewal harus jalan tiap 24 jam.
5. **JANGAN PUSH SECRETS** — `.env` di-gitignore. Token di `credentials/*.json` juga di-gitignore. Kalau user kasih API key di chat, save di `.env`, jangan paste ke file yang akan di-commit.
6. **JANGAN deploy Caddy** — nginx existing harus dipakai.
7. **PostgreSQL VinFast di port 5433** — 5432 dipakai container `atria-db`.

---

## 🔑 Token & Credentials Lokasi

```
/home/wabot/vinfast-bot/
├── .env                                    ← OpenRouter key + config (gitignored)
└── credentials/
    ├── sp-token.json                       ← SharePoint REST token, valid sampai Aug 2026
    └── graph-token.json                    ← backup Graph User.Read token
```

Saat token expired, refresh via curl:
```bash
REFRESH=$(jq -r .refresh_token credentials/sp-token.json)
curl -s -X POST \
  "https://login.microsoftonline.com/1f2b5b87-aa36-4655-9000-f099ad69d106/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "client_id=14d82eec-204b-4c2f-b7e8-296a70dab67e" \
  --data-urlencode "refresh_token=$REFRESH" \
  --data-urlencode "scope=https://amapartner.sharepoint.com/AllSites.Read offline_access"
```

---

## 📚 Bacaan Wajib di Sesi Awal

Sebelum reply user, baca **dalam urutan ini**:

1. `README.md` — quick overview project
2. `docs/PROGRESS-2026-05-12.md` — apa yang sudah dikerjakan
3. `docs/LEARNINGS.md` — 10 temuan kunci, **section 4 (data quality) wajib**
4. `docs/ARCHITECTURE.md` — schema PostgreSQL, docker-compose, nginx
5. `docs/TODO.md` — checklist apa yang harus dikerjakan
6. Memory `~/.claude/projects/-home-wabot/memory/project_vinfast_bot.md` (auto-loaded ke context)

---

## 💬 Style Komunikasi untuk Lucky

- **Singkat, langsung.** Lucky tidak suka jawaban panjang.
- **Mix Bahasa Indonesia + English teknis** OK. Contoh: "Token sudah expired, perlu refresh."
- **Tunjukkan hasil sebelum penjelasan.** "✅ Done." → "Detail di bawah."
- **Kalau ada konflik decision, BAHAS dengan singkat 2-3 opsi**, jangan langsung implement.
- **Push code = explicit approval only.** Kalau Lucky bilang "push", baru push.
- **Update memory + docs setiap milestone** — Lucky suka audit trail yang clean.

---

## 🎯 Definition of Done untuk Phase 0 (referensi)

Phase 0 dianggap selesai kalau:
- [ ] `docker compose up` jalan tanpa error
- [ ] Bot terima pesan WA "ping" → balas "pong"
- [ ] `curl https://vinfast.caricreatormu.my.id/health` → 200
- [ ] Sync worker download Jurnal Ompang.xlsx setiap 2 menit, UPSERT 107 rows ke PostgreSQL `ompang_tracking`
- [ ] `curl /api/stats` → return count: `{spk: 165, stok: 79, ompang: 107}`

---

## 🚨 Kalau Stuck

Hal-hal yang BUKAN bug, tapi sengaja:
- Excel `Booking DP` ada nilai "afsdf" → itu test data, skip
- Sheet header bukan row 1 → fitur, bukan bug
- Beberapa SPK row Name="cek"/"asd" → test data, filter
- Stok lokasi "LASWI-SOETA" combined → normalize ke "LASWI" prefer (atau split jika perlu)
- 13 group di /me/memberOf tanpa nama → memang scope User.Read terbatas, normal

Kalau benar-benar stuck, **tunjukkan error message konkret ke Lucky**, jangan tebak.

Selamat lanjut. 🚀
