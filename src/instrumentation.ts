/**
 * instrumentation.ts — הדמונים הנלווים:
 *  · גשר saos-dex: משגר את דמון הבורסה הריבונית (saos-dex, פורט 3010) כילד-תהליך
 *    של שרת האם — כך הוא שורד את מחזור-החיים של קריאות-המעטפת (מורשת guardian_boot).
 *  · הפעלה חד-פעמית לכל תהליך-שרת; בדיקת-תפוסה לפני שיגור + אימות-לאחר-שגר.
 *  · יבוא-דינמי בלבד (edge-safe) — net/child_process/fs בענף-nodejs בלבד.
 *
 * FIX(Roast-65-b):
 *  · M5 — allowlist-סביבה מפורש לילד: היה { ...process.env } שהזריק את כל-סביבת
 *    האם — כולל SOVEREIGN_VAULT_SECRET (מפתח-ה-AES של הכספת!) — לתהליך-הדקס,
 *    החשוף-ביותר-לרשת. עכשיו: deny-by-default, רק שמות-שהדקס באמת קורא
 *    (נמדדו מול saos-dex/src + .env.example) ומשתני-ריצה נטולי-סוד.
 *  · M6 — spawn לא-עיוור: stdout/stderr מנותבים ל-daemon-spawn.log (0600),
 *    poll-אימות-לאחר-שגר מקליט launchVerified (כמו ה-guardian), bun-אבסולוטי.
 *  · L5 — פרסר-.env מוקשח: מרכאות/הערות-בשורה/ייצוא נחתכים; שורות-פגומות
 *    נרשמות ומדולגות בקול (היה: ערכים-מושחתים-שקטים).
 */
const DEX_DIR = "/home/z/my-project/saos-dex";
const DEX_PORT = 3010;
const DEX_LOG = `${DEX_DIR}/daemon-spawn.log`;

// המצב-החי של הגשר — נרשם על globalThis כמו ה-guardian (Roast-64-a · F8)
interface BridgeRT {
  pid: number | null;
  launchVerified: boolean | null;
  launchVerifiedAt: number;
  lastError: string | null;
}
const g = globalThis as unknown as { __saosBridge?: BridgeRT };
function rt(): BridgeRT {
  if (!g.__saosBridge) g.__saosBridge = { pid: null, launchVerified: null, launchVerifiedAt: 0, lastError: null };
  return g.__saosBridge;
}

// ── M5: allowlist — כל-מה-שלא-רשום כאן לעולם לא חוצה את גבול-התהליך ─────────
// מדוד מול saos-dex/src (process.env.* שהדקס באמת קורא) + .env.example שלו.
const ALLOW_EXACT = new Set([
  // משתני-ריצה בסיסיים — אין-סודות
  "NODE_ENV", "PORT", "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
  // שמות-מפורשים שהדקס קורא (קונפיג לא-סודי)
  "DEX_OPERATOR_TOKEN", "SAOS_RELAY_AGENT_ACCOUNT", "SAOS_FLEET_VAULT_DIR",
  "SAOS_EXTERNAL_SIGNER_URL", "SAOS_EXTERNAL_SIGNER_TOKEN",
  "HIVE_ANCHOR_ACCOUNT", "ETH_EXPECTED_ADDRESS", "SOL_EXPECTED_ADDRESS",
  "ETH_RPC_URL", "SOL_RPC_URL", "ETH_BROADCAST_ENABLED", "SOL_BROADCAST_ENABLED",
]);
// מפתחות-חתימה/עיגון של הדקס — שמות-מפורשים-בלבד, לעולם לא ירושה-כללית
const ALLOW_KEYS = new Set([
  "STEEM_ACTIVE_WIF", "STEEM_POSTING_WIF", "HIVE_ACTIVE_WIF", "HIVE_POSTING_WIF",
  "BLURT_ACTIVE_WIF", // Roast-82: מסילת-BLURT — השרשרת-השביעית (אפס-RC, אפס-עלות)
  "ETH_PRIVATE_KEY", "SOL_PRIVATE_KEY", "TRON_PRIVATE_KEY",
]);
// משפחות-שמות ספציפיות-לדקס
const ALLOW_PREFIXES = ["SAOS_DEX_", "DEX_"];
function envAllowed(k: string): boolean {
  if (k.startsWith("SOVEREIGN_")) return false; // סודות-האם — חסימה-אקספליציטית גם-אם-נקרא-אחרת
  return ALLOW_EXACT.has(k) || ALLOW_KEYS.has(k) || ALLOW_PREFIXES.some(p => k.startsWith(p));
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ spawn }, net, fs] = await Promise.all([import("child_process"), import("net"), import("fs")]);
    const portBusy = (port: number): Promise<boolean> =>
      new Promise((resolve) => {
        const s = net.createConnection({ port });
        const done = (v: boolean) => { s.destroy(); resolve(v); };
        s.once("connect", () => done(true));
        s.once("error", () => done(false));
        setTimeout(() => done(false), 900).unref?.();
      });
    const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms).unref?.(); });

    try {
      if (!(await portBusy(DEX_PORT))) {
        // FIX(Roast-65-b · M5): deny-by-default — הילד מקבל רק את ה-allowlist;
        // SOVEREIGN_VAULT_SECRET / SOVEREIGN_RELAY_TOKEN ושאר סודות-האם לא עוברים.
        const childEnv: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || 'development' };
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined && envAllowed(k)) childEnv[k] = v;
        }
        try {
          const envPath = `${DEX_DIR}/.env`;
          const raw = fs.readFileSync(envPath, "utf8");
          // FIX(Roast-65-b · L5): פרסר-מוקשח — export/מרכאות/הערות-בשורה; שורה
          // פגומה → יומן-דילוג (לא ערך-מושחת-שקט). גם-כאן deny-by-default.
          raw.split("\n").forEach((line, i) => {
            const t = line.trim();
            if (!t || t.startsWith("#")) return;
            const body = t.startsWith("export ") ? t.slice(7).trim() : t;
            const eq = body.indexOf("=");
            if (eq <= 0) {
              console.log(`[saos-bridge] dex .env line ${i + 1} skipped (malformed: no KEY=VALUE)`);
              return;
            }
            const k = body.slice(0, eq).trim();
            let v = body.slice(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
              v = v.slice(1, -1); // מרכאות = חלק-מהערך-בלבד
            } else {
              const hash = v.indexOf(" #"); // הערה-בשורה (מחוץ-למרכאות)
              if (hash >= 0) v = v.slice(0, hash).trim();
            }
            if (!k) {
              console.log(`[saos-bridge] dex .env line ${i + 1} skipped (empty key)`);
              return;
            }
            if (!envAllowed(k)) return; // deny-by-default גם-בתוך ה-.env של הדקס
            childEnv[k] = v;
          });
        } catch {
          console.log("[saos-bridge] no saos-dex/.env found — relay will wait (honest pending)");
        }
        // הפרדת-מסדי-נתונים מחייבת: הדמון מקבל את ה-DB שלו-עצמו (saos-dex/db/dex.db) —
        // לעולם לא את ה-DATABASE_URL של הפלטפורמה-האם (custom.db). דורס-תמיד.
        childEnv.DATABASE_URL = "file:/home/z/my-project/saos-dex/db/dex.db";
        if (childEnv.SOVEREIGN_VAULT_SECRET) delete childEnv.SOVEREIGN_VAULT_SECRET; // belt&braces — לא-אמור-להגיע-לכאן

        // FIX(Roast-65-b · M6/L6): bun-אבסולוטי (process.execPath = הבינארי
        // שמריץ את השרת-הזה) — היה "bun" מ-PATH כשהילד-מקבל-env-סודות.
        const BUN = process.execPath;
        // כנות-מצב-ריצה: דמון-כסף על-סקריפט-dev רק-בפיתוח; בפרודקשן — start.
        const script = process.env.NODE_ENV === "production" ? "start" : "dev";
        if (script === "dev") {
          console.log("[saos-bridge] honest-note: launching dex with DEV script (next dev) — a money daemon on a dev server (Roast-65-b · M6 flag)");
        }
        // FIX(Roast-65-b · M6): stdio מנותב ללוג (היה stdio:"ignore" = שקט-מוחלט
        // שבלם-EADDRINUSE/קריסות-שגר); הקובץ 0600.
        let logFd: number;
        try {
          logFd = fs.openSync(DEX_LOG, "a", 0o600);
        } catch {
          logFd = fs.openSync("/dev/null", "a"); // אין-לוג → לא קריסה; ה-poll-למטה מספק-אמת
        }
        const child = spawn(BUN, ["run", script], {
          cwd: DEX_DIR,
          stdio: ["ignore", logFd, logFd],
          env: childEnv,
        });
        child.unref();
        rt().pid = child.pid ?? null;
        child.on("error", (e: Error) => {
          rt().lastError = `dex spawn error: ${e.message}`;
          console.log("[saos-bridge] dex spawn error:", e.message);
        });
        child.on("exit", (code: number | null) => {
          rt().lastError = `dex child exited (code=${code})`;
          console.log(`[saos-bridge] dex child exited (code=${code}) — guardian watchdog will revive on next poll`);
        });
        console.log(`[saos-bridge] saos-dex daemon spawning on :${DEX_PORT} (pid ${child.pid}, bun=${BUN}, script=bun run ${script}, stdout/stderr → daemon-spawn.log)`);

        // FIX(Roast-65-b · M6): אימות-לאחר-שגר — poll-עד-90ש׳ (next dev מתקמפל
        // לאט), התוצאה נקלטת ל-launchVerified כמו אצל ה-guardian.
        void (async () => {
          for (let i = 0; i < 45; i++) {
            await sleep(2000);
            if (child.killed || rt().lastError?.startsWith("dex child exited")) break;
            if (await portBusy(DEX_PORT)) {
              const r = rt();
              r.launchVerified = true;
              r.launchVerifiedAt = Date.now();
              r.lastError = null;
              console.log(`[saos-bridge] launch-verified: dex responding on :${DEX_PORT} (after ~${(i + 1) * 2}s)`);
              return;
            }
          }
          const r = rt();
          r.launchVerified = false;
          r.launchVerifiedAt = Date.now();
          if (!r.lastError) r.lastError = "post-spawn-verification-failed (port did not come up in 90s)";
          console.log(`[saos-bridge] launch-verification FAILED: ${r.lastError} — inspect ${DEX_LOG}`);
        })();
      } else {
        console.log(`[saos-bridge] saos-dex already listening on :${DEX_PORT}`);
      }
    } catch (e) {
      console.log("[saos-bridge] spawn skipped:", e instanceof Error ? e.message : e);
    }
  }
}
