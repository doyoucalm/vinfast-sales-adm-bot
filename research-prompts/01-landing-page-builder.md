# Research Prompt #1 — Landing Page Builder untuk Karyawan VinFast

**Context:** PT Otomobil Multi Artha (4 dealer VinFast di Bandung — Setiabudi, Pasteur, Laswi, Soetta). Karyawan sales perlu bikin landing page individual (untuk personal branding + lead capture) tanpa tergantung tim IT. Saat ini bot WA + dashboard internal sudah jalan di VPS Hostinger (Ubuntu, Docker stack).

**Goal:** Pilih 1 open-source landing page builder yang dideploy self-host, lalu coba install di VPS yang sama. Karyawan akses via subdomain (mis. `pages.vinfast.caricreatormu.my.id`) untuk drag-and-drop bikin landing page sendiri.

## Tugas

1. **Survey 7 kandidat open-source di GitHub** (urut star descending, filter language ts/js/php yang umum):
   - Plasmic (`plasmicapp/plasmic`)
   - GrapesJS (`GrapesJS/grapesjs`)
   - Webstudio (`webstudio-is/webstudio`)
   - Onlook (`onlook-dev/onlook`)
   - Mautic landing pages (`mautic/mautic`)
   - Astro Starlight + page-builder templates
   - Lain yang muncul dari search "landing page builder" stars >5k

2. **Untuk tiap kandidat, evaluasi:**
   - GitHub stars + tanggal commit terakhir (skip kalau >6 bulan tidak aktif)
   - License (boleh untuk komersial; flag AGPL/SSPL)
   - Bahasa Indonesia di UI (atau template-able)
   - Drag-and-drop UI non-technical?
   - Self-host requirement (DB, Redis, dll)
   - Templates yang siap pakai untuk niche otomotif/EV
   - Ekspor static HTML?

3. **Output:**
   - Tabel perbandingan markdown (7 baris)
   - Rank top 3 dengan alasan singkat
   - **TOP PICK** dengan langkah deploy: `docker-compose.yml` minimal + perintah eksekusi di VPS Hostinger
   - Resource requirement (RAM, CPU, disk minimum)

4. **Implementasi POC** (kalau bisa):
   - Clone repo top pick
   - Coba `docker compose up` di working directory `/home/wabot/landing-builder/` (BUAT directory ini)
   - Cek port mana yang harus expose (jangan tabrakan: 80/443/3000/3001/5432/5433/6379/6380/8080 sudah dipakai)
   - Verifikasi UI bisa loaded via curl
   - Stop container kalau sudah verified

5. **Hasil akhir:**
   - Tulis hasil ke `/home/wabot/research-results/landing-builder-{tanggal}.md`
   - Kirim ringkasan singkat ke WA Lucky (6282218255795) via Evolution API endpoint `http://localhost:8080`:
     ```
     curl -X POST http://localhost:8080/message/sendText/vinfast-bot \
       -H "apikey: $EVO_KEY" -H "Content-Type: application/json" \
       -d '{"number":"6282218255795","text":"... ringkasan ..."}'
     ```
     (cari `EVO_KEY` dari `/home/wabot/vinfast-bot/.env`)

## Constraint

- **Jangan pasang langsung ke production domain.** Test di subdomain atau local port saja.
- **Jangan ubah `evolution_nginx` config** existing.
- **Resource VPS terbatas** (1.5 CPU, 1G RAM untuk vinfast-bot). Pilih yang ringan.
- **Mahasiswa sales adalah pengguna akhir** — UI harus simpel, bahasa minim teknis.
