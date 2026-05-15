import {
  pgTable, serial, bigserial, integer, text, varchar, timestamp, boolean,
  numeric, jsonb, date, index, uniqueIndex, primaryKey, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════
// USERS & AUTH
// ═══════════════════════════════════════════════════════════════════

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  description: text("description"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) })
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    noHp: varchar("no_hp", { length: 20 }).notNull().unique(),
    nama: text("nama"),
    email: text("email"),
    roleId: integer("role_id").references(() => roles.id),
    dealer: text("dealer"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxRole: index("idx_users_role").on(t.roleId),
    idxDealer: index("idx_users_dealer").on(t.dealer),
  })
);

// ═══════════════════════════════════════════════════════════════════
// KARYAWAN — Whitelist + Auth (Postgres-first, SharePoint sync Phase 2)
// ═══════════════════════════════════════════════════════════════════

export const karyawan = pgTable(
  "karyawan",
  {
    id: serial("id").primaryKey(),
    noWa: varchar("no_wa", { length: 20 }).notNull().unique(),
    nama: text("nama").notNull(),
    jabatan: text("jabatan").notNull(),
    jabatanRaw: text("jabatan_raw"),
    role: text("role").notNull().default("other"),
    dealer: text("dealer"),
    tglJoin: date("tgl_join"),
    active: boolean("active").notNull().default(true),
    email: text("email"),
    metadata: jsonb("metadata"),
    source: text("source").notNull().default("MANUAL"),
    rawRow: jsonb("raw_row"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxActive: index("idx_karyawan_active").on(t.active),
    idxRole: index("idx_karyawan_role").on(t.role),
    idxJabatan: index("idx_karyawan_jabatan").on(t.jabatan),
  })
);

// ═══════════════════════════════════════════════════════════════════
// BUSINESS — Customer / SPK / Stok / Ompang / Payment
// ═══════════════════════════════════════════════════════════════════

export const customer = pgTable(
  "customer",
  {
    id: serial("id").primaryKey(),
    nik: varchar("nik", { length: 16 }).unique(),
    namaPembeli: text("nama_pembeli"),
    namaStnk: text("nama_stnk"),
    nikStnk: varchar("nik_stnk", { length: 16 }),
    email: text("email"),
    noHp: text("no_hp"),
    alamat: text("alamat"),
    npwp: text("npwp"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idxNoHp: index("idx_customer_no_hp").on(t.noHp) })
);

export const spk = pgTable(
  "spk",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id"),
    noSpk: text("no_spk").unique(),
    tglPengajuan: date("tgl_pengajuan"),
    dealer: text("dealer"),
    customerId: integer("customer_id").references(() => customer.id),
    tipeMobil: text("tipe_mobil"),
    warna: text("warna"),
    tipeBaterai: text("tipe_baterai"),
    vin: varchar("vin", { length: 17 }),
    paymentType: text("payment_type"),
    hargaOtr: numeric("harga_otr", { precision: 15, scale: 2 }),
    bookingDp: numeric("booking_dp", { precision: 15, scale: 2 }),
    bookingDpRaw: text("booking_dp_raw"),
    salesName: text("sales_name"),
    status: text("status"),
    source: text("source").notNull().default("EXCEL_SYNC"),
    rawRow: jsonb("raw_row"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chkDealer: check("chk_spk_dealer", sql`${t.dealer} IS NULL OR ${t.dealer} IN ('SETIABUDI','PASTEUR','LASWI','SOETA','OMA')`),
    idxVin: index("idx_spk_vin").on(t.vin),
    idxDealerStatus: index("idx_spk_dealer_status").on(t.dealer, t.status),
    idxTgl: index("idx_spk_tgl").on(t.tglPengajuan),
  })
);

export const stok = pgTable(
  "stok",
  {
    id: serial("id").primaryKey(),
    vin: varchar("vin", { length: 17 }).unique(),
    noMesin: text("no_mesin"),
    tipeMobil: text("tipe_mobil"),
    warna: text("warna"),
    tipeBaterai: text("tipe_baterai"),
    lokasi: text("lokasi"),
    status: text("status"),
    umurHari: integer("umur_hari"),
    rawRow: jsonb("raw_row"),
    lastSynced: timestamp("last_synced", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxTipeWarna: index("idx_stok_tipe_warna").on(t.tipeMobil, t.warna),
    idxLokasi: index("idx_stok_lokasi").on(t.lokasi),
    idxStatus: index("idx_stok_status").on(t.status),
  })
);

export const ompangTracking = pgTable(
  "ompang_tracking",
  {
    id: serial("id").primaryKey(),
    vin: varchar("vin", { length: 17 }),
    namaStnk: text("nama_stnk"),
    tipeMobil: text("tipe_mobil"),
    payment: text("payment"),
    domisili: text("domisili"),
    tglPengajuanOmpang: date("tgl_pengajuan_ompang"),
    tglPenerimaanOmpang: date("tgl_penerimaan_ompang"),
    tglSerahTerimaOmpang: date("tgl_serah_terima_ompang"),
    tglPengajuanFaktur: date("tgl_pengajuan_faktur"),
    tglPenerimaanFaktur: date("tgl_penerimaan_faktur"),
    statusFaktur: text("status_faktur"),
    tglPengajuanStnkBpkb: date("tgl_pengajuan_stnk_bpkb"),
    noSuratPengajuan: text("no_surat_pengajuan"),
    tglPenerimaanStnk: date("tgl_penerimaan_stnk"),
    noSuratPenerimaanStnk: text("no_surat_penerimaan_stnk"),
    tglSerahTerimaStnk: date("tgl_serah_terima_stnk"),
    noSuratSerahStnk: text("no_surat_serah_stnk"),
    tglPenerimaanBpkbBiro: date("tgl_penerimaan_bpkb_biro"),
    tglSerahTerimaBpkb: date("tgl_serah_terima_bpkb"),
    noSuratSerahBpkb: text("no_surat_serah_bpkb"),
    noInvoice: text("no_invoice"),
    nominalPayment: numeric("nominal_payment", { precision: 15, scale: 2 }),
    rawRow: jsonb("raw_row"),
    lastSynced: timestamp("last_synced", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxVin: index("idx_ompang_vin").on(t.vin),
    idxStatusFaktur: index("idx_ompang_status_faktur").on(t.statusFaktur),
  })
);

export const payment = pgTable(
  "payment",
  {
    id: serial("id").primaryKey(),
    spkId: integer("spk_id").references(() => spk.id),
    jenis: text("jenis"),
    nominal: numeric("nominal", { precision: 15, scale: 2 }),
    tglTransfer: timestamp("tgl_transfer", { withTimezone: true }),
    bankPengirim: text("bank_pengirim"),
    rekTujuan: text("rek_tujuan"),
    noRef: text("no_ref"),
    buktiTfUrl: text("bukti_tf_url"),
    ocrData: jsonb("ocr_data"),
    status: text("status").notNull().default("PENDING"),
    verifiedBy: integer("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idxSpk: index("idx_payment_spk").on(t.spkId) })
);

// ═══════════════════════════════════════════════════════════════════
// OPERATIONAL — Logs / LLM / Audit / ETL state
// ═══════════════════════════════════════════════════════════════════

export const messageLog = pgTable(
  "message_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").references(() => users.id),
    waNumber: text("wa_number"),
    direction: text("direction"),
    messageText: text("message_text"),
    messageType: varchar("message_type", { length: 20 }),
    intent: text("intent"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    entities: jsonb("entities"),
    handler: text("handler"),
    responseTimeMs: integer("response_time_ms"),
    llmUsed: boolean("llm_used").notNull().default(false),
    status: text("status"),
    errorMsg: text("error_msg"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxUserDate: index("idx_msglog_user_date").on(t.userId, t.createdAt),
    idxIntent: index("idx_msglog_intent").on(t.intent),
  })
);

export const llmCallLog = pgTable(
  "llm_call_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").references(() => users.id),
    inputText: text("input_text"),
    outputJson: jsonb("output_json"),
    model: text("model"),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    latencyMs: integer("latency_ms"),
    cacheHit: boolean("cache_hit").notNull().default(false),
    isOffPeak: boolean("is_off_peak").notNull().default(false),
    errorMsg: text("error_msg"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idxDate: index("idx_llm_log_date").on(t.createdAt) })
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tableName: text("table_name"),
    recordId: text("record_id"),
    action: text("action"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    source: text("source"),
    userId: integer("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idxTable: index("idx_audit_table").on(t.tableName, t.createdAt) })
);

export const etlState = pgTable("etl_state", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationState = pgTable("conversation_state", {
  waNumber: text("wa_number").primaryKey(),
  flow: text("flow"),
  step: text("step"),
  data: jsonb("data"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
