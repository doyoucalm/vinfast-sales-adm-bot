import { syncKaryawan } from "../jobs/sync-karyawan.js";
import { dbClose } from "../db/client.js";
import { redis } from "../services/redis.js";

async function main() {
  const force = process.argv.includes("--force");
  console.log(`\nRunning karyawan sync${force ? " (forced)" : ""}...\n`);
  const result = await syncKaryawan({ force });
  console.log(JSON.stringify(result, null, 2));
  await redis.quit();
  await dbClose();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
