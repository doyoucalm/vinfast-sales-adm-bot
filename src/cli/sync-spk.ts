import { syncSpkLeads } from "../jobs/sync-spk.js";
import { dbClose } from "../db/client.js";

async function main() {
  console.log("\nRunning SPK leads sync...\n");
  const result = await syncSpkLeads();
  console.log(JSON.stringify(result, null, 2));
  await dbClose();
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
