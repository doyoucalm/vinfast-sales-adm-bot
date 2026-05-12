# Long-Term Roadmap

**Horizon:** 6 bulan – 2 tahun setelah MVP go-live
**Last updated:** 12 Mei 2026

Item di sini BUKAN untuk Phase 0–4. Ini adalah feature/improvement yang akan diprioritaskan setelah bot stabil di production.

---

## A. Integrasi Sistem Eksternal

### A1. Integrasi Leasing Partner (Q3 2026 / Phase 5)
**Goal:** Sales bisa submit aplikasi kredit langsung dari WA, status kredit di-track real-time.

**Partner targets (priority order):**
1. MTF, SKBF, Adira (volume tertinggi)
2. CIMB, MUF
3. Clipan, Sinarmas, Maybank

**Challenge:** Setiap leasing punya API berbeda (sebagian masih file-based via SFTP/email).

**Approach:** Adapter pattern di `src/services/leasing/{mtf,skbf,...}.ts`. Implementasi per-partner berdasarkan dokumentasi mereka. Sebagian mungkin perlu RPA (Selenium) untuk leasing tanpa API.

### A2. Accounting Integration — Jurnal (Q4 2026)
**Goal:** Posting otomatis ke Jurnal Penjualan & Jurnal Pembayaran berdasarkan SPK + payment di sistem.

**Data sudah ada di Excel (Chart of Account di DB_FINANCE.xlsx ~89 entries).**

**Approach:**
- Build mapping table: payment_type + dealer → CoA debit/credit
- Generate Excel row mengikuti format `Jurnal Penjualan` dan `Jurnal Pembayaran Customer`
- Submit via SharePoint REST `getfilebyserverrelativeurl(...)/$value` (PUT untuk update)
- Atau: append rows ke sheet baru `Inbox_Accounting_Bot` di Google Sheets

### A3. SAMSAT/POLRI Integration (Q1 2027)
**Goal:** Auto-check status STNK real-time tanpa nunggu admin update Excel.

**Approach:** Scraping API SAMSAT online per provinsi (ada untuk Jabar, DKI, Jatim). Atau via partner data service.

---

## B. Bot Capabilities Expansion

### B1. Voice Note Support (Q3 2026)
**Goal:** Sales bisa ngomong (voice WA) instead of ngetik.

**Approach:**
- Detect message type = audio
- Download dari Evolution API
- Whisper API atau Google Speech-to-Text → text
- Forward text ke LLM preprocessor seperti biasa

**Cost:** Whisper ~$0.006/menit, asumsi 100 voice/hari × 30 detik = 25 jam/bulan = ~Rp 1.500.

### B2. Multi-Language (Q4 2026)
**Goal:** Customer Sunda/Jawa/English bisa pakai bot.

**Approach:** LLM prompt detect language → respond in same language. Atau user setting di profile.

### B3. Image Analysis Beyond OCR (Q1 2027)
**Goal:** Customer kirim foto mobil → bot identify tipe, warna, kondisi.

**Use case:**
- Foto unit baru sampai di gudang → auto-tag tipe/warna untuk update Stock Unit
- Foto damage report → auto-flag claim insurance

**Approach:** Vision LLM (Claude Haiku via OpenRouter ~$0.80/1M token).

### B4. Predictive Analytics
**Goal:** Forecast demand per tipe/dealer/bulan untuk planning stok.

**Approach:**
- Training data: 2 tahun history dari Jurnal Penjualan
- Model: simple linear regression atau Prophet
- Output: "Bulan depan Soetta butuh ~25 VF3, prefer Jet Black"
- Delivery: weekly report via WA ke manager

---

## C. Operational Excellence

### C1. Migrate ke WhatsApp Business API Official (Q3 2026)
**Why:** Evolution API pakai WA Web protocol, ada risk ban kalau volume tinggi. WA Business API lebih reliable + bisa template message + verified business profile.

**Cost:** ~Rp 200/conversation (USD 0.012 untuk Indonesia), atau langganan provider seperti Twilio/360dialog.

**Migration path:** Replace `src/services/evolution.ts` dengan `src/services/wa-business-api.ts`, sisanya tidak berubah.

### C2. Multi-Tenant Architecture (Q4 2026)
**Goal:** Satu codebase melayani multi dealer brand (selain VinFast).

**Approach:**
- Add `tenant_id` ke semua tabel
- Config per-tenant: SharePoint site, Google Drive folder, DeepSeek API key, WA instance
- DB schema per tenant atau row-level isolation
- Use case: kalau PT OMA ekspansi ke brand lain (Wuling, Chery, dll)

### C3. Mobile App for Admin (Q1 2027)
**Goal:** Admin sales bisa review SPK inbox dari handphone tanpa harus buka Google Sheets/laptop.

**Stack:** React Native + REST API endpoint di bot.

**Features:**
- Quick approve/reject SPK
- View document scans
- Search customer
- Live notification

### C4. Web Dashboard (Q2 2027)
**Goal:** Real-time dashboard untuk manager.

**Metrics:**
- Total SPK today/week/month
- Conversion rate per sales
- Stok aging (unit > 60 hari di gudang)
- STNK/BPKB processing time average
- Customer pipeline funnel

**Stack:** Next.js + Recharts + tRPC backend.

---

## D. Technical Debt & Refactoring

### D1. Replace SharePoint READ with Two-Way Sync
**Current:** Bot read-only ke SharePoint, admin manual copy dari Google Sheets ke Excel.

**Long-term:** Bot bisa WRITE ke SharePoint Excel directly via Excel REST API (Microsoft Graph atau SharePoint REST update).

**Blocker:** Butuh write scope yang mungkin balik ke admin consent issue.

**Workaround long-term:** Migrate Excel master ke Google Sheets sebagai single source of truth, deprecate SharePoint setelah 6 bulan dual-running.

### D2. Decouple from Evolution API Existing
**Current:** Bot share container Evolution API dengan Lunafore.

**Risk:** Lunafore restart → VinFast WA juga down.

**Long-term:** Deploy Evolution API instance terpisah khusus VinFast bot setelah scale up. Estimasi tambahan RAM 1GB, CPU 0.5 vCPU.

### D3. PostgreSQL → CockroachDB / Distributed
**When:** Saat traffic >10k pesan/hari (proyeksi Y2 setelah ekspansi).

**Why:** Horizontal scalability, multi-region replication, disaster recovery.

### D4. Centralized Logging — Loki / ELK
**Current:** Pino logs ke file lokal, di-rotate harian.

**Long-term:** Push semua logs ke centralized: Grafana Loki (cheap, self-hosted) atau Datadog (paid, fully managed).

**Benefit:** Cross-service correlation (bot + sync worker + Evolution), structured queries, anomaly detection.

### D5. Replace docxtemplater with Headless Browser Render
**Why:** docxtemplater + libreoffice-convert lambat (~3-5 detik per PDF). Headless Chromium with HTML template lebih cepat dan flexible (responsive layout, charts, dst).

---

## E. Compliance & Security

### E1. SOC 2 / ISO 27001 Compliance (Q2 2027)
**Trigger:** Kalau perusahaan butuh untuk partner enterprise.

**Effort:** 6 bulan, perlu auditor + dokumentasi process.

### E2. Personal Data Protection Indonesia (UU PDP)
**Current status:** UU PDP berlaku efektif Oktober 2024.

**Compliance items:**
- [ ] DPO appointed (Data Protection Officer)
- [ ] Privacy policy public untuk customer
- [ ] Consent collection saat customer onboarding
- [ ] Right to erasure: command `/hapus-data-saya` di WA untuk customer
- [ ] Data breach notification process (3x24 jam ke Kominfo)
- [ ] Encryption at rest untuk NIK + foto KTP
- [ ] Audit log retention 5 tahun

### E3. SIEM Integration
**Goal:** Threat detection real-time.

**Implementation:** Stream webhook_log + access_log + audit_log ke SIEM (Wazuh open-source atau Splunk).

---

## F. Business Intelligence

### F1. Customer Lifetime Value Tracking
**Goal:** Identifikasi customer high-value untuk loyalty program.

**Data needed:** Purchase history, service visits, referrals.

### F2. Sales Performance Leaderboard
**Goal:** Gamification untuk motivasi sales.

**Implementation:** Weekly leaderboard via WA broadcast ke grup sales (Top 10 by SPK closed, top 5 by conversion rate, dst).

### F3. Churn Prediction
**Goal:** Identifikasi customer yang likely tidak balik service di bengkel.

**Model:** Survival analysis based on service history.

---

## G. Cost Optimization

### G1. Self-host LLM (Q1 2027 jika cost meningkat)
**Trigger:** Kalau DeepSeek bill >$50/bulan.

**Approach:** Deploy Llama 3.3 70B di VPS GPU (estimasi $200/bulan untuk GPU rental) atau Mistral Small via vLLM. Break-even di ~$50/bulan API spend.

### G2. OCR Self-host (Q2 2027)
**Trigger:** Document AI cost >Rp 500.000/bulan.

**Approach:** PaddleOCR atau Tesseract + custom Indonesian KTP model. Akurasi mungkin turun 5-10%, tapi cost ~zero.

### G3. CDN untuk Document Serving
**When:** Kalau >1000 doc downloads/hari via WA.

**Approach:** Cloudflare CDN di depan Google Drive direct link.

---

## H. Disaster Recovery & Business Continuity

### H1. Active-Passive Multi-VPS Setup
**Goal:** Auto-failover kalau VPS utama mati.

**Approach:**
- VPS-2 di region berbeda (current di Eropa? — confirm dengan provider)
- PostgreSQL streaming replication
- DNS failover via Cloudflare
- RTO target: 5 menit, RPO: 1 menit

### H2. Data Retention Policy Formal
**Current:** ad-hoc.

**Long-term:**
- message_log: 90 hari hot, archive 2 tahun (Cloudflare R2)
- audit_log: 1 tahun hot, archive 7 tahun (regulatory)
- payment data: retain 10 tahun (regulasi finance)
- Customer KTP/KK: retain selama customer aktif + 5 tahun setelah opt-out

### H3. Quarterly DR Drill
- Restore from backup test
- Failover simulation
- Token re-issuance scenario

---

## I. Strategic Considerations

### I1. Open Source the Bot Engine
**When:** Kalau bot generik dan stabil setelah 1 tahun.

**Why:** Marketing untuk PT OMA sebagai tech-forward dealer, hire talent, community contributions.

**License:** AGPL-3.0 untuk protect against rebrand-and-sell.

### I2. White-label untuk Dealer Lain
**Goal:** Sell as SaaS ke dealer otomotif lain (BYD, Wuling, dll).

**Model:** Setup fee Rp 50jt + Rp 5jt/bulan per dealer.

**Prerequisite:** Multi-tenant architecture (C2 above) sudah ready.

### I3. AI Co-Pilot untuk Sales
**Goal:** Beyond bot Q&A — bot proactively suggest next action.

**Examples:**
- "Customer Budi sudah 5 hari tidak follow-up, kirim reminder?"
- "Stok VF3 Setiabudi tinggal 2 unit, push promo untuk closing minggu ini?"
- "Trend bulan ini: pertanyaan tentang Limo Green naik 300%, siapkan FAQ"

---

## Periodic Review

This doc di-review setiap **kuartal** bersama Lucky:
- Item yang udah selesai → move ke `CHANGELOG.md`
- Prioritas bisa shift berdasarkan business need
- Item baru di-tambah dari feedback admin/sales/customer
