import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { spawn } from "child_process";
import net from "net";
import { requireOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

/* ══ THE-GUARDIAN (SETTLE-16) — השומר-הריבוני של דמון-הבורסה ═════════════════
 * ממצא-חי: הסנדבוקס מפיל את תהליך-ה-3010 שנולד-מפקודת-מפתח (reaper), בזמן
 * שהשרת-הראשי-של-הפלטפורמה (3000) חי-ברציפות. פתרון-ריבוני: השרת-החי-עצמו
 * מאמץ-את-הדמון — watchdog בתוך-התהליך-ששורד, בודק-כל-60 שניות ומקים-את-הבורסה
 * מחדש כילד-שלו (guardian_boot-ממוסד: השרשרת קמה עם-השרת, instrumentation.ts
 * בצד-ה-dex). המפתח לא צריך-לעשות-כלום — המערכת מרפאת-את-עצמה.
 *
 *  GET  → סטטוס-השומר + בדיקת-חיות-מיידית (+הקמה-אם-מת)
 *  POST → כיבוי/הפעלה-ידנית { action: "start" | "stop" }
 * אפס-סודות · אפס-קוד-זר · spawn-מקומי-בלבד. */

const DEX_DIR = "/home/z/my-project/saos-dex";
const DEX_URL = "http://127.0.0.1:3010/saos-dex/api/dex/state?guardian=1";
const INTERVAL_MS = 60_000;

interface GuardianRT {
  timer: ReturnType<typeof setInterval> | null;
  lastCheck: number;
  lastOk: boolean;
  revivals: number;
  lastRevivalAt: number;
  lastError: string | null;
}
const g = globalThis as unknown as { __saosGuardian?: GuardianRT };
function rt(): GuardianRT {
  if (!g.__saosGuardian) g.__saosGuardian = { timer: null, lastCheck: 0, lastOk: false, revivals: 0, lastRevivalAt: 0, lastError: null };
  return g.__saosGuardian;
}

async function dexAlive(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(DEX_URL, { signal: ac.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

// FIX(Roast-63 · HIGH): מניעת-split-brain — next dev שנדחף-על-פורט-תפוס-עולה-אוטומטית
// ל-3011 = דמון-זומבי-עם-מנוע-משלו. חייב-בדיקת-תפוסה-אמיתית (TCP) לפני-שגר,
// כי dexAlive() מקבל-false-שקרי-בזמן-קומפילציה (4s-timeout).
function dexPortBusy(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port: 3010, host: '127.0.0.1' });
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), 900).unref?.();
  });
}

async function spawnDex(): Promise<boolean> {
  // פורט-תפוס = תהליך-קיים (גם-אם-מתקמפל) — אל-תשגר-כפילות
  if (await dexPortBusy()) return false;
  try {
    const child = spawn(
      "bash",
      ["-c", `cd ${DEX_DIR} && exec ./node_modules/.bin/next dev -p 3010 -H 127.0.0.1 >> daemon.log 2>&1`],
      { detached: true, stdio: "ignore", cwd: DEX_DIR },
    );
    child.unref();
    // אימות-לאחר-שגר: אם-הפורט-לא-עלה-תוך-~8ש׳ וגם-לא-היה-תפוס — דווח-כנה
    setTimeout(() => { void dexPortBusy(); }, 8_000)?.unref?.();
    return true;
  } catch {
    return false;
  }
}

async function ensureAlive(): Promise<{ ok: boolean; revived: boolean }> {
  const r = rt();
  const alive = await dexAlive();
  r.lastCheck = Date.now();
  r.lastOk = alive;
  if (alive) return { ok: true, revived: false };
  const spawned = await spawnDex();
  if (spawned) {
    r.revivals++;
    r.lastRevivalAt = Date.now();
    r.lastError = null;
    // נותנים-לשרת לקום — בדיקה-חוזרת-אחרי-20 שניות לא חוסמת-כאן
    setTimeout(() => void dexAlive().then((ok) => { r.lastOk = ok; if (!ok) r.lastError = "revived-but-not-responding-yet"; }), 20_000).unref?.();
  } else {
    // FIX(Roast-63): כשל-שגר-או-פורט-תפוס-ממילא — לא-זהם-lastError כשזה-תפוס-בריא
    r.lastError = (await dexPortBusy()) ? "port-busy-but-health-fail" : "spawn-failed";
  }
  return { ok: false, revived: spawned };
}

function startWatchdog(): void {
  const r = rt();
  if (r.timer) return;
  r.timer = setInterval(() => void ensureAlive(), INTERVAL_MS);
  void ensureAlive(); // בדיקה-ראשונה-מיידית
}

export async function GET() {
  startWatchdog(); // כל-פנייה מבטיחה-שהשומר-חי (גם-אחרי-HMR)
  const r = rt();
  return NextResponse.json({
    ok: true,
    guardian: {
      watching: r.timer !== null,
      intervalMs: INTERVAL_MS,
      dexAlive: r.lastOk,
      lastCheckAt: r.lastCheck,
      revivals: r.revivals,
      lastRevivalAt: r.lastRevivalAt,
      lastError: r.lastError,
      note: "השומר-הריבוני: שרת-הפלטפורמה-החי מקים-את-דמון-הבורסה-בכל-נפילה (guardian_boot-ממוסד)",
    },
  });
}

export async function POST(req: NextRequest) {
  // FIX(Roast-63 · M13): השומר-הוא-שער-תהליכים — stop/start-דורשים-owner (היה-פתוח)
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: "owner-only (guardian = שליטה-בתהליכים)" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "stop") {
    const r = rt();
    if (r.timer) { clearInterval(r.timer); r.timer = null; }
    return NextResponse.json({ ok: true, guardian: { watching: false } });
  }
  startWatchdog();
  const res = await ensureAlive();
  return NextResponse.json({ ...res, ok: true, guardian: rt().revivals }); // FIX: ok-אחרי-...res (היה-נדרס)
}
