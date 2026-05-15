import { listKaryawan, karyawanStats } from "../services/karyawan.js";
import { dbClose } from "../db/client.js";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(=(.*))?$/);
    if (m) args[m[1]!] = m[3] ?? "true";
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const activeOnly = args["active"] === "true" || args["active"] === "1";

  const rows = await listKaryawan({
    activeOnly,
    role: args["role"],
  });

  console.log(`\n📋 Karyawan (${rows.length} rows${activeOnly ? ", active only" : ""}):\n`);
  console.log("  ID  | No WA           | Nama                                | Jabatan                  | Role           | Active");
  console.log("  " + "-".repeat(115));
  for (const r of rows) {
    console.log(
      `  ${String(r.id).padStart(3)} | ${r.noWa.padEnd(15)} | ${r.nama.padEnd(35)} | ${r.jabatan.padEnd(24)} | ${r.role.padEnd(14)} | ${r.active ? "✅" : "❌"}`
    );
  }

  const stats = await karyawanStats();
  console.log(`\n📊 Stats by role:`);
  for (const s of stats.sort((a, b) => b.total - a.total)) {
    console.log(`  ${s.role.padEnd(15)} → total: ${String(s.total).padStart(3)}, active: ${String(s.active).padStart(3)}`);
  }
  console.log();

  await dbClose();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
