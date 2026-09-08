# סקר תיקיות-הסוכנים — מה יש לנו, מסקנות, וחיבור הכול

*2026-09-08 (Asia/Jerusalem) · נכתב אחרי ביקורת פיזית של כל תיקיית-עבודה בריפו, בהוראת הבעלים:
לבדוק את תיקיות הסוכנים, להסיק מסקנות, לאסוף מה שלא ידענו שיש, לחבר הכול, ולתקן מהמדמם.*

---

## 0. התיקון המדמם שבוצע בביקורת זו

**תקלה:** 267 קובצי-tracked הופיעו כ-modified — `0 insertions / 0 deletions`, שינוי-mode בלבד
`100644 → 100755` (הכול הפך executable; סבירות גבוהה: חילוץ-ZIP או sync של ה-sandbox).

**התיקון:**
1. שחזור מצב ה-index בלבד (`chmod 644` על 267 הקבצים — כולם אמורים להיות לא-executable).
2. **חיזוק מבני:** `git config core.fileMode false` — ה-sandbox מוכח כמהפך modes מחוץ לשליטתנו;
   מעתה git מתעלם מהרעש (ה-index עצמו נשמר: 1,087 קבצים שהם באמת executable — עץ skills ו-.zscripts —
   נותרו כרגיל).

**אימות:** `git status` נקי לחלוטין אחרי התיקון; השרת המשיך לעבוד (health 200) לאורך כל התהליך.

---

## 1. מפת התיקיות (מה בדקנו ומה נמצא)

| תיקיית-סוכן | מה זה | סטטוס | ערך היום |
|---|---|---|---|
| `engineering/zip-analysis-20260907-1520/` | workspace הנדסי מסודר (00_input→07_scripts) לניתוח ZIPs/`steem main` מ-2026-09-07 | **BLOCKED — missing inputs**, בכנות מלאה (לא הומצא כלום) | ⭐⭐⭐ המלצה מותנית מדורגת + תבנית-ניתוח לשימוש-חוזר + `environment-scan.sh` v4 (קריאה-בלבד, בטיחות-סודות) |
| `wallet-design/` | **מסמכי-היסוד של הריפו הזה** (2026-09-07): network-analysis → breakthrough-ideas → wallet-architecture → final-proposal | ההצעה שהולידה את M0–M3 | ⭐⭐⭐⭐ מפת-דרכים לא-ממומשת: F1–F5 + R1–R3 (ראה §2) |
| `tool-results/` | שרף-סשן של סוכן מתקופת M2 (פלטי read/bash שמורים) | ארכיון | ⭐⭐ **ראיית-ביקורת**: `bash_1788788693278` מתעד `Ref 'refs/heads/main' was rewritten` + `commits containing .env/upload in history: 0` — תימוכין ל-`docs/security-review-response.md`. לא למחוק בלי החלטת-בעלים |
| `tests/` | רתמות-בדיקה ל-.zscripts: `python-runtime-build.sh` · `database-runtime-build.sh` · `python-runtime-container.sh` | תשתית-בדיקה | ⭐⭐⭐ לא הוזכר באף worklog קודם — **נכס-נסתר**: הוכחת-היתכנות ל-build של רנטיים python/db בתוך הסנדבוקס |
| `download/` | placeholder ("Here are all the generated files") | ריק | ⭐ אין — נשאר כדוגמת-מבנה |
| `examples/websocket/` | דמו socket.io הרשמי (שרת+לקוח) | רפרנס | ⭐ ידוע — בשימוש לתבנית mini-services עתידית |
| `skills/` | עץ skills מערכתי (נכנס ב-auto-commit) | לא שלנו | ⭐ לא-רלוונטי למוצר; מוגדר כרגיל ב-index |

---

## 2. החיבור הגדול: ההצעה המייסדת (F1–F5, R1–R3) מול מה שנבנה בפועל

הצלבה של `wallet-design/final-proposal.md` מול הקוד החי (grep אמיתי, לא זיכרון):

| תכונה מההצעה | סטטוס בפועל | ראייה |
|---|---|---|
| **R1** Password-First Keys | ✅ **נבנה והוכח** | Argon2id verifier + seal/unlock (`packages/core/src/vault/keys.ts`); עבר ביקורת-פורנזית (AUDIT-RESP: 0 מופעי-סיסמה ב-DB אחרי lifecycle) |
| **R2** Policy Engine | ✅ **נבנה ומעבר להצעה** | static/dynamic/contextual/composite + anomalies (`packages/core/src/policy/`) — ההצעה ביקשה "lite", קיבלנו מנוע מלא |
| **F4** Memo Vault | 🟡 **תפר קיים, התכונה לא** | `operations.ts` תומך memo (bit-verified M0) + `types.ts:90` מצהיר במפורש: *"Encrypted memos (\"#…\") are a Memo Vault (M2) concern"* — נדחה, לא נעשה |
| **F5** Governance Cockpit | 🟡 **signable, בלי קוקפיט** | `witness_vote` טיפוס-פעולה חתים דרך הכספת (`packages/core/src/types.ts:34`) — אין UI לבריאות-witnesses/proposals |
| **F1** Aurora Modes | 🟡 **מרומז ב-role/policy, אין UX מצבים** | מערכת roles ל-7 רשתות + policy per-op מכסים את התת-תכונה "חתימה במפתח הפחות-מורשה"; אין מסתב Social/Treasury/Vault |
| **F3** Tri-Token Treasury | 🟡 **תצוגה חיה, בלי power ops** | WALLET: STEEM/SBD/SP/RC חי + ETH/SOL (M3); פעולות power up/down + לוח 13-שבועות — לא נמצאו בקוד |
| **F2** Zero-Gate Onboarding | ❌ **לא בריפו הזה** | יצירת-חשבונות קיימת בפועל ב-agent החיצוני (`steem` repo: factory loop — 13 החיילים הם ההוכחה), אבל לא כזרימת-onboarding למשתמש |
| **R3** In-app Signals | 🟡 **חלקי** | audit chain + RC manabar חי; אין feed התראות על העברות/שינוי-authorities |

**מסקנת-חיבור:** המסמך המייסד לא אבד — הוא הרשימת-העבודות הטבעית ל-M5+. הסדר המומלץ לפי הראיות:
R3 (זול, ממלא פער-תפעולי) → F4 Memo Vault (התפר כבר ביט-verified) → F5 Cockpit (הפעולה כבר חתימה) →
F1 Modes (שכבת-UX על מה שיש) → F3 power ops (פעולות-רשת חדשות) → F2 (דורש תיאום עם ה-agent החיצוני).

---

## 3. ההמלצה המותנית מ-zip-analysis — איפה אנחנו ביחס אליה

ה-workspace ההנדסי (שקדם ל-M0!) דירג: **אינדקסר+API = 8.7** · ארנק self-custody = 8.3 ·
רשת-חדשה/fork = 3.5 (הנמוך מכול).

**מה קרה בפועל:** הבעלים בחר ארנק (8.3) — ובנה סביבו אקוסיסטם. האינדקסר לא נבנה כנפרד, **אבל**
שכבת-קריאה חיה התגלגלה ממילא: `/api/saos/hub`, `/api/saos/fleet-status`, `/api/steem/orderbook`,
`/api/system/health` — כולם read-layer עם cache/TTL שמזין את הדשבורד ואת ה-API המסחרי (Model 1).

**מסקנה כנה:** ההמלצה ההיסטורית עדיין פתוחה בחלקה — אין אינדקסר היסטורי (Postgres) ואין API ציבורי
יציב לצד-ג'; מה שיש הוא read-layer חי-on-demand. למי שירצה להמשיך את הקו: התבנית מוכנה
(`03_code_analysis/analysis-template.md`) והדירוג המקורי עדיין הגיוני.

---

## 4. החלטות-בעלים שנאספו מהסקר (לא בוצע בלי אישור)

1. `tool-results/` — להשאיר (תימוכין-ביקורת) או לארכב? **המלצה: להשאיר**, מסומן כ-evidence.
2. F2 (Zero-Gate Onboarding) — להביא לריפו הזה או להשאיר ב-agent החיצוני? דורש הכרעת-אדריכלות.
3. האינדקסר ההיסטורי (ההמלצה המדורגת 8.7) — להתחיל לפני/אחרי Model 1 Week 2 (SDK)?
4. עץ `skills/` — נכנס לריפו ב-auto-commit; לשקול `.gitignore` עתידי (החלטת-בעלים, לא שלנו).

---

## 5. איך לאמת את הסקר הזה

```bash
# התיקון המדמם: אין שום דיפ בתוכן
git diff HEAD --stat | tail -1   # אחרי ה-push: אמור להיות ריק

# מצב modes מול ה-index (אחרי core.fileMode=false — שקט = תקין)
git config core.fileMode         # false

# הדלתא של §2 בעצמך:
rg -n "witness_vote" packages/core/src/types.ts
rg -n "Memo Vault" packages/chains/steem/src/operations.ts    # שורה 90 — התפר המוצהר
rg -il "power.?up" src/          # אפס תוצאות = F3 באמת חסר
```
