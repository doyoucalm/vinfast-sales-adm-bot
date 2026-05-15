# Research Prompt #2 — How-to Build Social Media + Open Source Tooling

**Context:** Sama dengan #1. Karyawan sales VinFast Bandung butuh strategi + tooling untuk social media management. Target audience: calon pembeli mobil listrik di Bandung & sekitar, segmen menengah-atas.

**Goal:**
- Guide praktis (markdown) "How to Build Social Media for EV Dealership"
- Pilih 1 open-source social media scheduler self-host yang siap deploy
- Coba install di VPS dan verifikasi UI bisa diakses

## Tugas

### Part A — Guide "How to Build Social Media for EV Dealership"

Tulis guide dalam markdown 1500-2500 kata, sections:

1. **Platform priorities & rationale**
   - TikTok (test-drive shorts, education content EV)
   - Instagram (Reels + Carousel, customer stories)
   - YouTube Shorts (long-form trust-building)
   - Facebook (komunitas Bandung & generasi 30+)
   - Tier-2 (LinkedIn, X, Threads) — ya/tidak + alasan

2. **Content pillars (5 pillar)**
   - Edukasi EV (charging, range, biaya operasional)
   - Test drive testimonial customer
   - Behind-the-scenes dealer/sales day
   - Comparison VinFast vs ICE competitor (Brio, Avanza, dll)
   - Lifestyle ownership (charging di mall, road trip Bandung-Jakarta)

3. **Posting cadence**
   - Template content calendar mingguan (Senin-Minggu, slot pagi/siang/malam)
   - Frekuensi per platform (mis. IG: 1 reel/hari + 3 carousel/minggu)

4. **Karyawan personal branding playbook**
   - Profile setup do's & don'ts
   - Caption template (3 variation: edukasi, soft-sell, story)
   - Hashtag strategy (local + niche EV)

5. **Measurement & iteration**
   - KPI per platform (reach, save, share, DM lead)
   - Tools gratis untuk analytics

### Part B — Open Source Tool Survey

Survey 5-7 kandidat self-host social media scheduler/manager di GitHub:
- **Postiz** (`gitroomhq/postiz-app`) — Tier-1 candidate, sudah pernah di-mention komunitas
- **Mixpost** (`inovector/Mixpost`) — Laravel-based
- **Publer**, **Buffer self-host alternatives**
- **Mautic** (marketing automation include social)
- **Hyvor Talk / Plausible related**
- Hasil dari search "social media scheduler self-host" di GitHub

Untuk tiap kandidat evaluasi:
- Stars + commit terakhir
- License (boleh komersial)
- Platform support (TikTok? IG? FB? minimum harus support IG + TikTok)
- Self-host requirements (docker-compose ada? DB requirement)
- API integration (perlu Facebook Developer / TikTok API key — apakah supported?)
- UI Indonesian-friendly (atau English mudah dipahami)

### Part C — Implementasi POC (Top Pick)

1. Pilih TOP PICK berdasar evaluasi Part B
2. Buat directory `/home/wabot/social-media-tool/`
3. Setup `docker-compose.yml` minimal (jangan tabrakan port: 80,443,3000,3001,5432,5433,6379,6380,8080)
4. `docker compose up -d`
5. Test akses UI via curl + verifikasi response 200
6. Stop container setelah verifikasi
7. Dokumentasi step-by-step deploy di hasil akhir

### Output

- Tulis guide + survey + POC log ke `/home/wabot/research-results/social-media-{tanggal}.md`
- Kirim ringkasan ke WA Lucky (6282218255795) via Evolution:
  ```
  curl -X POST http://localhost:8080/message/sendText/vinfast-bot \
    -H "apikey: $EVO_KEY" -H "Content-Type: application/json" \
    -d '{"number":"6282218255795","text":"... ringkasan ..."}'
  ```
  (cari `EVO_KEY` dari `/home/wabot/vinfast-bot/.env`)

## Constraint

- Jangan deploy ke public domain — local port test saja
- Jangan modifikasi production stack `vinfast-bot/docker-compose.yml`
- Karyawan adalah pengguna akhir — UI tool harus walkable tanpa training panjang
- Anggaran token: gunakan WebSearch + WebFetch untuk research, jangan loop infinite
