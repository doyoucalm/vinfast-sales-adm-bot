# VinFast Sales Admin Bot — Project VFB-2026-001

WhatsApp bot otomasi sales admin untuk PT Otomobil Multi Artha (4 dealer VinFast).

**Owner:** Lucky Surya Haryadi (Lucky@amapartner.org)
**Status:** Phase 0 — Discovery selesai, siap implementasi
**Last update:** 12 Mei 2026

---

## 📂 Struktur Folder

```
vinfast-bot/
├── README.md                    ← anda di sini
├── docs/
│   ├── PROGRESS-2026-05-12.md   ← log progress hari ini
│   ├── LEARNINGS.md             ← temuan kunci yang harus di-apply saat dev
│   ├── ARCHITECTURE.md          ← arsitektur final feasible
│   ├── TODO.md                  ← action items Phase 0-4
│   └── LONG-TERM.md             ← roadmap >Phase 4 (6 bulan - 2 tahun)
├── credentials/                 ← tokens (gitignored)
│   ├── sp-token.json            ← SharePoint REST token (refresh 90 hari)
│   └── graph-token.json         ← Graph User.Read backup token
└── data-samples/                ← snapshot Excel master 12 Mei 2026
    ├── jurnal_sales.xlsx        (344KB, 15 sheets — PRIMARY)
    ├── ompang.xlsx              (96KB, 6 sheets)
    └── db_mobil.xlsx            (68KB, master mobil/warna/leasing)
```

---

## 🚦 Status Hari Ini (12 Mei 2026)

### ✅ Done
- VPS port mapping confirmed via `docker ps`
- SharePoint REST auth scope `AllSites.Read` **TIDAK butuh admin consent** ✅
- Live download 3 file Excel master VinFast
- Konfirmasi struktur 15 sheet di Jurnal Sales Mobil
- Snapshot data: 79 stok ready, 107 ompang entries, 165 SPK rows
- Identifikasi 8 issue data quality kritis

### 🟢 Status Blocker (per sore 12 Mei 2026 — semua clear)
1. ✅ **Nomor WA** — `085101438585` bisa dipakai untuk bot, tinggal scan QR
2. ⏳ **GCP setup** — bisa di-handle parallel di Phase 1, tidak block Phase 0
3. ✅ **OpenRouter API key** — sudah di `.env`

### 🔜 Next Action
Setelah 3 blocker di atas resolved, langsung mulai Phase 0 dari `docs/TODO.md`.

---

## 🔑 Key Findings (Quick Reference)

| Topic | Detail |
|-------|--------|
| Auth strategy | SharePoint REST (BUKAN Graph), scope `AllSites.Read` |
| Tenant ID | `1f2b5b87-aa36-4655-9000-f099ad69d106` |
| Site ID | `amapartner.sharepoint.com,88323408-d5f7-46f4-9dec-d2b928a44db9,8d84178b-431b-4665-8281-808a8d124643` |
| API base | `https://amapartner.sharepoint.com/sites/VinFast/_api/` |
| File primary | `/sites/VinFast/Shared Documents/Jurnal/Sales/Jurnal Sales Mobil.xlsx` |
| File ompang | `/sites/VinFast/Shared Documents/Jurnal/Sales/Jurnal Ompang.xlsx` |
| nginx existing | `evolution_nginx` di port 80/443 — pakai ini, bukan Caddy |
| Port bot | 3001 internal |
| Port DB | 5433 (host) untuk PostgreSQL VinFast |
| Port Redis | 6380 (host) |

---

## 🧰 Token & Sample Data

**Token SharePoint** (`credentials/sp-token.json`):
- Access token TTL: ~67 menit
- Refresh token TTL: 90 hari, sliding
- Scope: `https://amapartner.sharepoint.com/AllSites.Read`

**Sample test commands:**

```bash
# Test SharePoint REST access
SP_TOKEN=$(jq -r .access_token credentials/sp-token.json)
curl -s -H "Authorization: Bearer $SP_TOKEN" \
  -H "Accept: application/json;odata=nometadata" \
  "https://amapartner.sharepoint.com/sites/VinFast/_api/web?\$select=Title,Url"

# Re-download Excel master
curl -s -H "Authorization: Bearer $SP_TOKEN" \
  -o /tmp/jurnal-baru.xlsx \
  "https://amapartner.sharepoint.com/sites/VinFast/_api/web/getfilebyserverrelativeurl('/sites/VinFast/Shared%20Documents/Jurnal/Sales/Jurnal%20Sales%20Mobil.xlsx')/\$value"

# Refresh token jika expired
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

## 📖 Bacaan Wajib Sebelum Coding

1. **`docs/LEARNINGS.md`** — terutama section "Data Quality di Excel Master" dan "SharePoint REST API Quick Reference"
2. **`docs/ARCHITECTURE.md`** — schema PostgreSQL & docker-compose final
3. **`docs/TODO.md`** — checklist Phase 0

---

## 🗂️ Reference Memory

Project juga di-track di Claude memory:
- `~/.claude/projects/-home-wabot/memory/project_vinfast_bot.md` (v1.3 updated)
- Index: `MEMORY.md`
