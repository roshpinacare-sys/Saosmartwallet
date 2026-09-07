# Final Proposal — Saosmartwallet

| שדה | ערך |
|---|---|
| תאריך | 2026-09-07 (Asia/Jerusalem) |
| סטטוס | ⚠️ הצעה סופית **מותנית** באישור רשת היעד (הנחה מסומנת: משפחת Steem) — ראו §8 |
| יעד repo | `github.com/roshpinacare-sys/Saosmartwallet` (פרטי, ריק, branch `main`) |
| שרשרת מסמכים | [`network-analysis.md`](./network-analysis.md) → [`breakthrough-ideas.md`](./breakthrough-ideas.md) → [`wallet-architecture.md`](./wallet-architecture.md) → **מסמך זה** |
| עומק הנדסי | workspace נלווה: [`../engineering/zip-analysis-20260907-1520/`](../engineering/zip-analysis-20260907-1520/README.md) |

---

## 1. חזון

**Saosmartwallet** הוא הארנק הראשון שמתייחס לרשת ממשפחת Steem כמו שהיא: פרוטוקול של **זהות + חברה + כסף** — ולא "ביטקוין עם שמות". במקום לחקות ארנקי EVM (מפתח אחד, גז בכל פעולה, 0x…), הארנק מממש את מה שרק הרשת הזו מאפשרת:

> **מצבי הרשאה במקום מפתח חם אחד · עבודה לפני שיש כסף (RC) · תיק שמבין שלושה נכסים · קבלות מוצפנות · אזרחות רשת (ממשל) — הכול non-custodial.**

התוצאה: ארנק שנוח כמו אפליקציית Web2, בטוח **מבנית** (הפרוטוקול מגן, לא רק ה-UX), ומקטין את חיכוך האימוץ לאפס.

## 2. היקף MVP — 5 תכונות Core + 3 Rails

| # | תכונה | מה נכלל | ערך מדיד |
|---|---|---|---|
| F1 | **Aurora Modes** | מצבי Social/Treasury/Vault; חתימה אוטומטית במפתח הפחות-מורשה; unlock per-op ל-active | הפרדת סיכון מבנית |
| F2 | **Zero-Gate Onboarding** | יצירת חשבון צד-לקוח; סוללת RC (מד+התראה); זרימת "שאל סוללה" (בקשת delegation); claimed accounts כשזמין | עסקה ראשונה בלי לקנות קריפטו |
| F3 | **Tri-Token Treasury** | יתרות שלושת הנכסים + RC; power up מיידי; power down עם לוח 13-שבועות ויזואלי | ניהול מחזור חיי הון |
| F4 | **Memo Vault** | העברות עם הערה מוצפנת; קבלות חכמות; צפיית "שיחת עסקה" | פרטיות נייטיב |
| F5 | **Governance Cockpit** | הצבעת witnesses עם מדדי בריאות; הצבעת proposals; פעילות ממשל אישית | אזרחות רשת בלחיצה |
| R1 | **Password-First Keys** (rail) | גזירת מפתחות צד-לקוח; דף גיבוי QR; אפס seed-phrase UX | onboarding נגיש ובטוח |
| R2 | **Policy Engine lite** (rail) | תקרת הוצאה יומית; אישור יעד חדש; audit log מקומי | שטח נזק מוגבל |
| R3 | **In-app Signals** (rail) | התראות בממשק: העברה, RC נמוך, שינוי authorities | זיהוי פריצה מוקדם |

**מחוץ ל-MVP (מפורש):** Extension/Mobile/SDK (Phase 3) · Recovery Circle מלא, Social Pay, שוק delegation, Market Pulse מלא (Phase 2) · **גשרים, custody, הבטחות תשואה — לעולם לא** (הצהרת אי-תחום ב-architecture §5.5).

## 3. סטאק טכנולוגי

| שכבה | בחירה |
|---|---|
| לקוח | Next.js 16 (App Router, PWA) · TypeScript 5 strict · Tailwind CSS + shadcn/ui |
| State | Zustand (מצב לקוח) · TanStack Query (שרת) |
| ליבה | monorepo pnpm+Turborepo · `packages/core-domain|chain-adapter|keystore|ui-kit|sdk` |
| רשת | `chain-adapter` על בסיס dhive (מבודד מאחורי interface — ניתן להחלפה) · JSON-RPC+WS |
| אבטחה | WebCrypto + OS keychain · CSP קפדני · multi-node quorum · ולידציית zod על כל תגובת RPC |
| Indexer | Node/TS קריאה-בלבד · SQLite (MVP) → Postgres · WS fan-out |
| איכות | Vitest · Playwright · GitHub Actions (typecheck→lint→test→SCA) · changesets |
| פריסה | container סטנדרטי; secrets ב-store מנוהל; `.env` מקומי בלבד ומחוץ ל-git |

פירוט מלא: [`wallet-architecture.md`](./wallet-architecture.md) §3, §5, §7.

## 4. מבנה משלוח (Repository)

```
Saosmartwallet (repo, branch main)
├── docs/ → מסמכי wallet-design (5) + engineering workspace + ADRs + threat model
├── apps/web-wallet/ → הארנק (Next.js)
├── packages/* → ליבה משותפת (core-domain, chain-adapter, keystore, ui-kit, sdk)
├── services/indexer/ → קריאה-בלבד
└── tools/ → CI + test vectors
```
מבנה המונורפו וחוקי התלויות — [`wallet-architecture.md`](./wallet-architecture.md) §3.

## 5. תוכנית שלבית + מילסטונים

```
שבוע:  0──2──4──6──8──10──12──14──16
       [M0][────M1────][──M2──][M3][M4]
```

| מילסטון | שבועות | תכולה | שער יציאה (Gate) |
|---|---|---|---|
| **M0 — החלטת רשת** | 0–2 | אישור רשת+chain-id, סקר RPC חי, אימות KDF/ops מול קוד המקור של הרשת, ADR-001 | ⛔ רשת מאושרת + endpoint חי מגיב — **אין קוד חתימה לפני זה** |
| **M1 — שלד קורא** | 2–5 | monorepo, keystore (גזירה+slots), web-wallet shell, Treasury קריאה-בלבד, indexer-lite | יתרות/RC מוצגות מול endpoint חי; וקטורי KDF עוברים |
| **M2 — חתימה ומצבים** | 5–8 | Aurora Modes, Policy lite, העברות חתומות, power up/down, Memo (שליחה+קריאה) | עסקה חתומה end-to-end על רשת בדיקה; סקירת אבטחה פנימית #1 עוברת |
| **M3 — Onboarding+ממשל** | 8–10 | יצירת חשבון, סוללת RC, זרימת שאל-סוללה, Governance Cockpit, In-app Signals | עסקה ראשונה למשתמש חדש בלי קניית קריפטו; הצבעת witness עובדת |
| **M4 — קשיחות** | 10–12 | E2E מלא, hardening (CSP/quorum/zeroization), docs, beta build | 0 קריטיים מסקירה #1; ביקורת חוץ (KDF/keystore) מתוכננת ל-Phase 2 |

**הערכת משאבים:** צוות מומלץ — 2 מהנדסי fullstack (TS) + 1 מעצב/ת (חלקי) + יועץ אבטחה (ביקורת Phase 2) → **~12 שבועות** עד beta סגור. מפתח סולו → **~4–5 חודשים** (M2 הוא הכבד). תלוי משאבים חיצוניים: endpoint חי (M0) ותקציב ביקורת חוץ (לפני beta ציבורי).

## 6. סיכונים ומיגון

| סיכון | הסתברות | השפעה | מיגון |
|---|---|---|---|
| הנחת הרשת שגויה/משתנה | בינוני | גבוה | core network-agnostic + adapter; שער M0 חוסם התחייבות לפני אימות |
| Public RPC לא אמין/לא זמין | בינוני | גבוה | multi-node quorum; מסלול self-host node (Phase 2); fail closed |
| פגם בגזירת/אחסון מפתחות | נמוך | קריטי | וקטורי בדיקה מול מפרט הרשת; ביקורת חוץ; owner מעולם לא חם; תקרות הוצאה |
| פישינג/הנדסה חברתית | גבוה | בינוני | סיסמה רק במסך vault; אזהרות מובנות; Recovery דורש threshold; אין "תמיכה" שנוגעת במפתחות |
| שרשרת אספקה (npm) | בינוני | בינוני | מינימום תלויות, lockfile נעול, SCA ב-CI, build דטרמיניסטי |
| רגולציה | נמוך | בינוני | non-custodial מלא (אין נאמנות נכסים); הצהרות ברורות; אין גשרים/תשואות |
| תלות במפתח יחיד (bus factor) | בינוני | בינוני | monorepo מתועד, ADRs, CI אוכף איכות, docs נלווים |
| שינוי כלכלת RC/עמלות ברשת | נמוך | בינוני | הגדרות RC בשכבת adapter; ניטור hardfork versions |

## 7. מדדי הצלחה (beta)

1. **Onboarding**: עד 3 דקות מרגישות לעסקה ראשונה — בלי שהמשתמש קנה קריפטו.
2. **אמינות**: שיעור הצלחת חתימה-ושידור ≥ 99.5%.
3. **אבטחה**: 0 ממצאים קריטיים פתוחים בביקורת; 0 מפתחות בשרת (ניתן לביקורת בקוד).
4. **אימוץ ממשל**: % משתמשים שהצביעו ל-witness/proposal ב-30 הימים הראשונים.

## 8. נקודות החלטה נדרשות מבעל הפרויקט (חוסמות)

| # | החלטה | חוסמת |
|---|---|---|
| D1 | רשת יעד מדויקת + chain id (Steem? Hive? fork פרטי?) | M0 — הכול |
| D2 | RPC endpoint(s) חיים לפיתוח/בדיקות | M0 |
| D3 | רישיון המאגר (למשל MIT/Apache-2.0) ורישיון קוד הרשת | פרסום ראשון |
| D4 | מיתוג/שם מוצר סופי + כיוון עיצוב | M1 UI |
| D5 | תקציב ביקורת אבטחה חוץ | beta ציבורי (אחרי M4) |

## 9. המלצות מסכמות

1. **אל תפתחו קוד חתימה לפני ש-D1/D2 נסגרות** — זהו השער היחיד שעלול לבזבז חודשי עבודה.
2. **בנו ליבה network-agnostic** — גם אם הרשת תשתנה, רוב הקוד שורד (כבר מעוגן ב-architecture §1).
3. **התחילו מ-onboarding ומצבי הרשאה** — זה הדיפרנציאטור; כל השאר נבנה עליהם.
4. **שמרו על non-custodial מוחלט** — פשטות רגולטורית, אמון משתמש, ושטח אבטחה קטן.
5. **סודות**: הטוקן בשימוש ל-push בהיקף רחב מדי — לצמצם ל-`repo` בלבד או לשלול אחרי השימוש; לעולם לא להעלות טוקנים לקבצים/צ'אט.

## 10. צעדים מיידיים (Checklist)

- [x] ניתוח רשת (מותנה, מסומן) — `network-analysis.md`
- [x] רעיונות + בחירת Cores — `breakthrough-ideas.md`
- [x] ארכיטקטורה מלאה — `wallet-architecture.md`
- [x] הצעה סופית — מסמך זה
- [x] Push ל-repo `Saosmartwallet`
- [ ] **D1**: אישור רשת יעד + chain id *(עליך)*
- [ ] **D2**: אספקת RPC endpoint חי *(עליך)*
- [ ] **D3/D4**: רישיון + מיתוג *(עליך)*
- [ ] פתיחת M0: סקר endpoints + אימות KDF מול קוד מקור הרשת
