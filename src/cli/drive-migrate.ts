import { migrateDriveFromLeadsSpk } from "../jobs/drive-migrate.js";
import { dbClose } from "../db/client.js";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  console.log(`\nDrive migration${dryRun ? " (DRY RUN)" : ""}${limit ? ` limit=${limit}` : ""}...\n`);
  const result = await migrateDriveFromLeadsSpk({ dryRun, limit });
  console.log(JSON.stringify(result, null, 2));
  await dbClose();
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
