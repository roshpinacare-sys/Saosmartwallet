/**
 * /api/saos/dex-bridge — guardian_boot on-demand:
 * משגר את דמון saos-dex (:3010) כילד של שרת-האם (ששרד את מחזור-החיים של
 * קריאות-המעטפת). כבר-חי? מדווח already:true — אפס-כפילויות.
 * אותו-חוזה שהיה-לנו-תמיד: GET פשוט, סביבה-מוזרקת מ-saos-dex/.env,
 * לוג-דמון ל-saos-dex/daemon.log, DATABASE_URL מוצמד ל-db/שלו.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import net from "net";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

export async function GET() {
  const portBusy = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const s = net.createConnection({ port });
      const done = (v: boolean) => { s.destroy(); resolve(v); };
      s.once("connect", () => done(true));
      s.once("error", () => done(false));
      setTimeout(() => done(false), 900).unref?.();
    });

  try {
    if (await portBusy(3010)) {
      return NextResponse.json({ ok: true, already: true, port: 3010 });
    }
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    try {
      const raw = fs.readFileSync("/home/z/my-project/saos-dex/.env", "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim();
        if (k) childEnv[k] = v;
      }
    } catch {
      /* ללא .env — ה-Relay ימתין בכנות (honest pending) */
    }
    let daemonFd: number = -1;
    try {
      daemonFd = fs.openSync("/home/z/my-project/saos-dex/daemon.log", "a");
    } catch { /* fallback ל-ignore */ }
    const stdio: ("ignore" | number)[] = ["ignore", daemonFd >= 0 ? daemonFd : "ignore", daemonFd >= 0 ? daemonFd : "ignore"];
    const child = spawn("bun", ["run", "dev"], {
      cwd: "/home/z/my-project/saos-dex",
      stdio: stdio as unknown as "ignore",
      env: { ...childEnv, DATABASE_URL: "file:/home/z/my-project/saos-dex/db/dex.db" },
    });
    child.unref();
    child.on("error", (e: Error) => console.log("[dex-bridge] spawn error:", e.message));
    return NextResponse.json({ ok: true, spawned: true, pid: child.pid, port: 3010 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : "spawn failed" },
      { status: 500 },
    );
  }
}
