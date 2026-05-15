import { upsertKaryawan } from "../services/karyawan.js";
import { dbClose } from "../db/client.js";

type SeedRow = {
  nama: string;
  no_wa: string;
  tgl_join: string;
  jabatan: string;
  status: string;
  force_role?: string;
};

const SEED: SeedRow[] = [
  { nama: "Alexander Regi Panggabean", no_wa: "083142146830", tgl_join: "01/02/2026", jabatan: "Sales", status: "Aktif" },
  { nama: "Syifaa Ananda Febianty", no_wa: "081313767722", tgl_join: "01/02/2026", jabatan: "Sales", status: "Aktif" },
  { nama: "Indah Erlina Fitriyani", no_wa: "08978319146", tgl_join: "01/02/2026", jabatan: "Sales", status: "Aktif" },
  { nama: "Sopian Agung", no_wa: "089526770146", tgl_join: "01/02/2026", jabatan: "sales", status: "Aktif" },
  { nama: "Riki Sangga Wijaya", no_wa: "085640949695", tgl_join: "01/02/2026", jabatan: "sales", status: "Aktif" },
  { nama: "Syahrul Ichsan Herdiana", no_wa: "085143326867", tgl_join: "01/02/2026", jabatan: "Sales", status: "aktif" },
  { nama: "Ricky Suprayogi", no_wa: "087732668866", tgl_join: "01/02/2026", jabatan: "Sales", status: "Aktif" },
  { nama: "Indra Surya Muharja", no_wa: "085864173476", tgl_join: "01/02/2026", jabatan: "Sales", status: "Aktif" },
  { nama: "Muhammadan Andriansyah Permana", no_wa: "085721681688", tgl_join: "01/09/2025", jabatan: "sales consultant senior", status: "aktif" },
  { nama: "Michellino Hendira Putra", no_wa: "083179306661", tgl_join: "02/09/2025", jabatan: "sales consultant senior", status: "aktif" },
  { nama: "Muhammad Siddik Ramadhan", no_wa: "083185385309", tgl_join: "02/09/2025", jabatan: "sales consultant senior", status: "aktif" },
  { nama: "Aldi Minsyailin", no_wa: "0881023653810", tgl_join: "08/12/2025", jabatan: "junior sales consultant", status: "aktif" },
  { nama: "Yusni Rahma", no_wa: "081280819319", tgl_join: "18/04/2026", jabatan: "training", status: "aktif" },
  { nama: "Nisa Sri Dewi", no_wa: "0881011206716", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Usep Saripudin", no_wa: "081312231422", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Yolanda Fitria", no_wa: "085659224042", tgl_join: "18/04/2026", jabatan: "training", status: "aktif" },
  { nama: "Putri Lyra Amelia", no_wa: "081323526711", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Monica Mega Dara", no_wa: "083100521649", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Raden Verdi Febrian Surianata", no_wa: "082121877855", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Reni Permatasari", no_wa: "08228675747", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Taufik Gunawan", no_wa: "085869091217", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Pegy Putri Rahma", no_wa: "085746859287", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Heni Agustiani", no_wa: "082129569080", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Agus Sofyan", no_wa: "089648065398", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Yuliani", no_wa: "081320008282", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Gina Ratna Sari", no_wa: "085871280105", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Fazza Badruttamam", no_wa: "085624337331", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Nabila Febrianti Zahran", no_wa: "083160820835", tgl_join: "05/05/2026", jabatan: "training", status: "aktif" },
  { nama: "Raisha Khairunnisa", no_wa: "08112202304", tgl_join: "01/02/2026", jabatan: "Admin", status: "aktif" },
  { nama: "Mega Putra Irawan Sukma", no_wa: "081218399943", tgl_join: "01/01/2026", jabatan: "Area Manager", status: "aktif" },
  { nama: "Triaji Fahmi Ilman", no_wa: "082116792181", tgl_join: "01/01/2026", jabatan: "Branch Manager", status: "aktif" },
  { nama: "Sandi Yulius Hidayat", no_wa: "081322420440", tgl_join: "01/01/2025", jabatan: "Branch Manager", status: "aktif" },
  { nama: "Kurnia", no_wa: "081321828262", tgl_join: "01/01/2025", jabatan: "Branch Manager", status: "aktif" },
  { nama: "R. Heri Setiawan", no_wa: "082214849913", tgl_join: "01/01/2025", jabatan: "Branch Manager", status: "aktif" },
  { nama: "Lucky Surya Haryadi", no_wa: "082218255795", tgl_join: "01/01/2025", jabatan: "Owner", status: "aktif", force_role: "owner" },
];

async function main() {
  console.log(`\nSeeding ${SEED.length} karyawan...\n`);

  let created = 0, updated = 0, failed = 0;
  for (const k of SEED) {
    try {
      const result = await upsertKaryawan({
        nama: k.nama,
        no_wa: k.no_wa,
        jabatan: k.jabatan,
        tgl_join: k.tgl_join,
        active: k.status,
        source: "SEED",
        raw_row: k,
        force_role: k.force_role,
      });
      if (result.created) created++; else updated++;
      const flag = result.created ? "✅" : "♻️ ";
      console.log(`  ${flag}  ${result.row.noWa.padEnd(15)} ${result.row.nama.padEnd(35)} ${result.row.jabatan.padEnd(28)} ${result.row.role}`);
    } catch (e) {
      failed++;
      console.error(`  ❌  ${k.no_wa.padEnd(15)} ${k.nama.padEnd(35)} ERROR: ${(e as Error).message}`);
    }
  }

  console.log(`\n📊 Result: ${created} created, ${updated} updated, ${failed} failed`);
  await dbClose();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
