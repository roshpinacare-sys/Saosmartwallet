import { saosHubSnapshot } from "@/lib/saos-hub";
try {
  const r = await saosHubSnapshot();
  console.log("ok:", r.ok, "soldiers:", r.soldiers?.length, "live:", r.steemAccountsLive);
} catch (e) {
  console.error("THREW:", e);
}
process.exit(0);
