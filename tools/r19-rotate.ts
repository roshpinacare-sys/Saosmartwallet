/** r19 — operator-authorized rotation driver. Usage: bun run tools/r19-rotate.ts <status|preview|rotate> [account] */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const cmd = process.argv[2] || "status";
  const account = process.argv[3];
  // mint an operator session (opens the vault in-process — the standing authorization of r19)
  const s = await fetch("http://localhost:3000/api/gate/session", { method: "POST" });
  const sj = (await s.json()) as { ok: boolean; token?: string };
  if (!sj.ok || !sj.token) throw new Error(`session mint failed`);
  const H = { Authorization: `Bearer ${sj.token}`, "Content-Type": "application/json" };
  try {
    if (cmd === "status") {
      const r = await fetch("http://localhost:3000/api/gate/rotation", { method: "POST", headers: H, body: JSON.stringify({ action: "status" }) });
      const j = await r.json();
      const t = (j?.targets ?? []) as Array<{ account: string; ready: boolean; hasOwnerKey: boolean; hasP5Root: boolean }>;
      console.log("readyCount:", j?.readyCount, "| targets:", t.length);
      for (const x of t) console.log(` ${x.ready ? "READY" : "    "} ${x.account} ownerKey=${x.hasOwnerKey} p5=${x.hasP5Root}`);
    } else if (cmd === "preview") {
      const r = await fetch("http://localhost:3000/api/gate/rotation", { method: "POST", headers: H, body: JSON.stringify({ action: "preview", account }) });
      const j = await r.json();
      console.log(JSON.stringify(j, null, 1).slice(0, 1500));
    } else if (cmd === "rotate") {
      const r = await fetch("http://localhost:3000/api/gate/rotation", { method: "POST", headers: H, body: JSON.stringify({ action: "rotate", account }) });
      const j = await r.json();
      console.log(JSON.stringify(j));
    }
  } finally {
    await fetch("http://localhost:3000/api/gate/lock", { method: "POST", headers: H, body: "{}" });
  }
}
main().finally(() => db.$disconnect());
