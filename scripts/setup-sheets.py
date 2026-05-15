#!/usr/bin/env python3
"""
Setup script: auto-create 3 tabs + headers di SalesBot_Inbox spreadsheet.
Idempotent — bisa di-run berkali-kali, hanya add tab yang belum ada.

Usage:
    cd /home/wabot/vinfast-bot
    python3 scripts/setup-sheets.py
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build

load_dotenv()

SA_KEY = os.getenv("GOOGLE_SA_KEY_FILE", "/opt/sales-bot/credentials/google-sa.json")
SPREADSHEET_ID = os.getenv("GSHEETS_INBOX_ID")

if not SPREADSHEET_ID:
    print("❌ GSHEETS_INBOX_ID belum ada di .env")
    sys.exit(1)
if not Path(SA_KEY).exists():
    print(f"❌ SA key tidak ditemukan: {SA_KEY}")
    sys.exit(1)

creds = service_account.Credentials.from_service_account_file(
    SA_KEY, scopes=["https://www.googleapis.com/auth/spreadsheets"]
)
sheets = build("sheets", "v4", credentials=creds)

TABS = {
    "Leads_SPK": [
        "timestamp", "no_spk_temp", "sales_wa", "sales_nama", "dealer",
        "nama_pembeli", "nama_stnk",
        "nik_pembeli", "tgl_lahir_pembeli", "alamat_pembeli",
        "tipe_mobil", "warna", "baterai", "pembayaran", "booking_nominal",
        "tf_bank", "tf_nominal", "tf_berita", "tf_referensi",
        "status_lengkap", "warnings",
        "foto_ktp_pembeli", "foto_ktp_stnk", "foto_tf",
        "status_review", "reviewed_by", "reviewed_at", "no_spk_final", "notes",
    ],
    "KTP_Parsed": [
        "timestamp", "sales_wa", "nik", "nama",
        "tempat_lahir", "tgl_lahir", "jenis_kelamin",
        "alamat", "rt_rw", "kelurahan", "kecamatan", "kabupaten", "provinsi",
        "agama", "status_kawin", "pekerjaan", "kewarganegaraan", "berlaku_hingga",
        "ocr_confidence", "foto_url",
        "context", "linked_spk_temp", "save_as_customer", "customer_id",
    ],
    "Setoran_Pending": [
        "timestamp", "sales_wa", "sales_nama",
        "linked_to", "linked_id", "customer_nama", "customer_hp",
        "jenis_setoran", "nominal", "nominal_words",
        "bank_pengirim", "nama_pengirim", "no_rek_pengirim",
        "bank_tujuan", "no_rek_tujuan",
        "tgl_transfer", "jam_transfer", "no_referensi",
        "foto_bukti", "ocr_confidence",
        "status_verif", "verified_by", "verified_at", "notes_admin",
        "pushed_to_db", "pushed_at",
    ],
}


def get_existing_tabs():
    meta = sheets.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    return {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta["sheets"]}


def add_tab(title):
    req = {"addSheet": {"properties": {"title": title}}}
    res = sheets.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID, body={"requests": [req]}
    ).execute()
    return res["replies"][0]["addSheet"]["properties"]["sheetId"]


def set_headers(title, headers):
    sheets.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{title}!A1",
        valueInputOption="USER_ENTERED",
        body={"values": [headers]},
    ).execute()


def format_header(sheet_id):
    requests = [
        {
            "updateSheetProperties": {
                "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount",
            }
        },
        {
            "repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {"red": 0.2, "green": 0.4, "blue": 0.8},
                        "textFormat": {
                            "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
                            "bold": True,
                        },
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat)",
            }
        },
    ]
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID, body={"requests": requests}
    ).execute()


def main():
    print(f"🔧 Setup tabs di spreadsheet {SPREADSHEET_ID[:20]}...\n")
    existing = get_existing_tabs()
    print(f"📋 Existing tabs: {', '.join(existing.keys())}\n")

    for tab_name, headers in TABS.items():
        if tab_name in existing:
            sheet_id = existing[tab_name]
            print(f"♻️  Tab '{tab_name}' sudah ada (id={sheet_id}), update header...")
        else:
            sheet_id = add_tab(tab_name)
            print(f"✅ Tab '{tab_name}' created (id={sheet_id})")

        set_headers(tab_name, headers)
        format_header(sheet_id)
        print(f"   📝 {len(headers)} columns: {', '.join(headers[:5])}{'...' if len(headers) > 5 else ''}\n")

    print("🎉 Setup complete.")
    print(f"\nBuka: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit")


if __name__ == "__main__":
    main()
