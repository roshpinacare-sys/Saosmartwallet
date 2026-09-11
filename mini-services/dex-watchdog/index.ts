/**
 * dex-watchdog (roast-79) — סדום-הפעמה של מנוע-ה-DEX.
 *
 * האילוץ-המתועד (worklog 78-g): ה-sandbox מרג-את-תהליך-ה-DEX (~60-90ש׳ אחרי-boot,
 * oom_kill מצטבר ב-cgroup). השרשרת עצמה בטוחה — חוזרת-מ-snapshot בדטרמיניזם-מלא —
 * אבל-הפעמה נעצרת, והכלכלה (חיילים→מסחר→עמלות→מזרקה→דלק) לא-מספיקה-להחלים-בין-
 * ההריגות. הפתרון-הכנה: לופ-השגחה שמעיר-את-המנוע דרך-המשגר-הקנוני (dex-daemon)
 * בכל-פעם-שהוא-נעלם. אפס-גישה-למפתחות, אפס-גישה-ל-db — רק-בדיקת-HTTP + ספאון.
 */
const STATE_URL = "http://127.0.0.1:3010/saos-dex/api/dex/state";
const PROBE_MS = 20_000; // כל-20ש׳
const TIMEOUT_MS = 6_000; // תגובה-איטית-מדי = לא-חי
const FAILS_TO_RESTART = 2; // שני-כישלונות-רצופים לפני-הפעלה-מחדש
const RESTART_COOLDOWN_MS = 60_000; // לפחות-דקה-בין-הפעלות (מניעת-סופת-ריסטארטים)
const BOOT_GRACE_MS = 90_000; // אחרי-הפעלה: שנייה-לחמם לפני-שמספירים-כישלונות

let fails = 0;
let lastRestartAt = 0;
let booting = false;

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
}

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(STATE_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

async function restart(): Promise<void> {
  if (booting) return;
  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) {
    log(`restart-suppressed (cooldown ${RESTART_COOLDOWN_MS / 1000}s)`);
    return;
  }
  booting = true;
  lastRestartAt = now;
  fails = 0;
  log("DEX נעלם — משגר-מחדש דרך dex-daemon (DATABASE_URL-קנוני, הגנת-הקולוניזציה)");
  // pkill זהיר-מדויק: רק-הדמון-של-3010 — לעולם לא relay/אם.
  // FIX(roast-79): תבנית [n]ext — pkill -f עם-התבנית-הגולמית היה-מתאים-לשורת-הפקודה
  // של-bash -c עצמו (self-match) והורג-את-המשגר-שלעצמו לפני-הספאון ("spawn הושלם"
  // היה-שקר-קר: ה-bash מת-מ-pkill, הדמון מעולם-לא-קם).
  const cmd = `pkill -f "[n]ext dev -p 3010" 2>/dev/null; sleep 1; cd /home/z/my-project/mini-services/dex-daemon && nohup bun run dev >> /home/z/my-project/dex-dev.log 2>&1 & echo watchdog-spawned`;
  try {
    const proc = Bun.spawn(["bash", "-c", cmd], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    await proc.exited;
    log("spawn הושלם — הדמון באתחול (boot-grace 90s)");
  } catch (e) {
    log(`spawn-נכשל: ${e}`);
  } finally {
    booting = false;
  }
}

async function loop() {
  // FIX(roast-79): try/catch-כולל — בלי-זה rejection יתום (בעיקר-בזמן-הצטת-hot-reload)
  // הרג-את-לופ-ההשגחה בשקט. השגחה חייבת-לשרוד-הכל.
  try {
    const alive = await probe();
    if (alive) {
      if (fails > 0) log(`DEX חזר-לחיים (${fails} כישלונות-קודמים)`);
      fails = 0;
      return;
    }
    fails++;
    log(`probe-כישלון ${fails}/${FAILS_TO_RESTART}`);
    if (fails >= FAILS_TO_RESTART) await restart();
  } catch (e) {
    log(`loop-שגיאה-נתפסת (ממשיך): ${e}`);
  }
}

log("dex-watchdog על-תורן — משגיח על 3010 (roast-79)");
process.on("unhandledRejection", (e) => log(`unhandledRejection-נבלע (ממשיך): ${e}`));
process.on("uncaughtException", (e) => log(`uncaughtException-נבלע (ממשיך): ${e}`));
setInterval(() => void loop().catch((e) => log(`interval-loop-נפל: ${e}`)), PROBE_MS);
void loop().catch((e) => log(`first-loop-נפל: ${e}`)); // בדיקה-ראשונה מיד
