# Saosmartwallet — ארנק פורץ-דרך לרשת ממשפחת Steem

> **סטטוס: M0 Core מומש ואומת מול ה-chain · keystore/policy ממתינים ל-M1**
> עדכון אחרון: 2026-09-07 (Asia/Jerusalem)

מאגר זה מכיל את עיצוב המוצר והארכיטקטורה המלאים עבור **Saosmartwallet** — ארנק self-custodial שמנצל את התכונות הייחודיות של רשת ממשפחת **Steem** (היררכיית מפתחות owner/active/posting/memo · עסקאות ללא עמלות דרך Resource Credits · הצפנת memo נייטיב · ממשל מובנה), במקום לחקות ארנקי EVM.

✅ **הצהרת תקפות (מעודכנת 2026-09-07):** בעל הפרויקט אישר את **פרוטוקול Steem** כרשת היעד, וההנחה עברה מ"הנחה מסומנת" ל"מאומתת מול chain חי" — כל פורמטי ה-wire במאגר נגזרו ואומתו מול bytes אמיתיים מ-`https://api.steemit.com` (ראו §M0 למטה). הליבה נשארת network-agnostic: פורקים ידרשו רק chain-id/סימול/prefix בקונפיגורציה.

## 📚 מפת המסמכים (סדר קריאה מומלץ)

| # | מסמך | תוכן |
|---|---|---|
| 1 | [`wallet-design/network-analysis.md`](./wallet-design/network-analysis.md) | ניתוח הרשת: ממצאי סריקה, הנחת העבודה, ארכיטקטורה/קונצנזוס/כלכלה/API של הרשת (ידע ציבורי, מסומן), נקודות חוזק ייחודיות + [פלט סריקה גלמי](./wallet-design/network-scan-raw-output.md) |
| 2 | [`wallet-design/breakthrough-ideas.md`](./wallet-design/breakthrough-ideas.md) | 15 רעיונות פורצי-דרך מדורגים (Impact×Feasibility) + בחירת **5 Core + 3 Rails** עם נימוקים |
| 3 | [`wallet-design/wallet-architecture.md`](./wallet-design/wallet-architecture.md) | ארכיטקטורה מלאה: דיאגרמות ASCII, מונורפו, ממשק ChainAdapter, אבטחה (מחזור חיי מפתחות, Policy Engine, threat model), תוכנית שלבים עם שערים |
| 4 | [`wallet-design/final-proposal.md`](./wallet-design/final-proposal.md) | ההצעה הסופית: חזון, MVP (5 תכונות), סטאק, מילסטונים M0–M4, הערכת זמן/משאבים, סיכונים, נקודות החלטה |
| — | [`engineering/zip-analysis-20260907-1520/`](./engineering/zip-analysis-20260907-1520/README.md) | workspace הנדסי נלווה: סריקות סביבה (v4), דוחות חסרים, המלצה מותנית לרשת, roadmap פריסה |

## 🧭 החלטות מרכזיות (קיצור)

1. **5 תכונות Core ל-MVP:** Aurora Modes (מצבי-הרשאה) · Zero-Gate Onboarding (עובד לפני שיש כסף) · Tri-Token Treasury · Memo Vault · Governance Cockpit.
2. **תשתיות Rails:** גזירת מפתחות צד-לקוח בלי seed-phrase UX · Policy Engine (תקרות הוצאה) · התראות פנימיות.
3. **אבטחה מעל הכול:** מפתחות לעולם לא יוצאים מהלקוח · owner key מעולם לא חם · indexer קריאה-בלבד · ללא custody/גשרים/הבטחות תשואה.
4. **שער M0:** אין קוד חתימה לפני אישור רשת+chain-id+RPC חי (ראו §8 ב-final-proposal).

## 🚦 מה נדרש להתקדמות (מבעל הפרויקט)

- **D1:** אישור רשת יעד מדויקת + chain id · **D2:** RPC endpoint חי · **D3:** רישיון · **D4:** מיתוג · **D5:** תקציב ביקורת אבטחה. פירוט: [`final-proposal.md` §8](./wallet-design/final-proposal.md).

## 🧪 M0 Core — מומש ואומת מול ה-chain החי (2026-09-07)

השער M0 נפתח: הבעלים אישר את **פרוטוקול Steem** כרשת היעד (D2); endpoint לפיתוח: `https://api.steemit.com` (D1). תוצרי ה-M0:

| נכס | תיאור | סטטוס |
|---|---|---|
| [`packages/crypto/`](./packages/crypto/README.md) | PrivateKey/PublicKey/חתימות, WIF + "STM", גזירת מפתחות מ-password/brain-key | ✅ מומש ואומת |
| [`packages/chains/steem/`](./packages/chains/steem/README.md) | מנוע serialization בינארי (varint/asset/ops/tx) + SteemAdapter עם broadcast נעול | ✅ מומש ואומת |
| [`packages/core/`](./packages/core/README.md) | Keystore AES-256-GCM + Policy Engine | ⬜ M1 |
| `tools/serialize-test.ts` | סוויטת אימות מול chain חי | ✅ **30/30 PASS** |

**קריטריוני קבלה שעברו מול ה-chain האמיתי** (קריאה-בלבד): serialization **זהה ביט-אחר-ביט** ל-serializer של הצומת עצמו (10/10 עסקאות) · sha256 על ה-bytes שלנו = `transaction_id` מה-chain (10/10) · חתימות אמיתיות מה-chain משוחזרות בדיוק למפתחות ה-authority של החותם — הוכחת מסלול חתימה מלא בלי שידור.

**לקחים אמפיריים שנתגלו ותוקנו בזכות אימות מול bytes אמיתיים** (מתועדים ב-README של packages/chains/steem): שדה Asset הוא 16 בייטים (לא 15/14) · checksum של "STM" הוא `ripemd160(pub)` ישירות · header חתימה = 31+recid · `condenser_api` דורש פרמטרים מערכיים.

```bash
bun tools/serialize-test.ts --rpc https://api.steemit.com --samples 10   # הוכחה חוזרת (קריאה-בלבד)
bun tools/chain-health-check.ts --rpc https://api.steemit.com           # בדיקת תקינות צומת
```

## 🔐 הערות אבטחה למאגר זה

- `.env` ו-`upload/` **אינם חלק מההיסטוריה** (נוקו לפני ה-push הראשון) ומוחרגים ב-`.gitignore`.
- טוקן ה-GitHub ששימש ל-push אינו מאוחסן במאגר ואינו מצוטט בשום מסמך; מומלץ לצמצם את היקפו/לשלולו לאחר השימוש.

## 🛠️ הסקפולד במאגר

המאגר כולל סקפולד Next.js 16 + TypeScript (App Router, Prisma/SQLite, shadcn/ui) — בית עתידי ל-`apps/web-wallet` לפי הארכיטקטורה. מבנה המונורפו המתוכנן: [`wallet-architecture.md` §3](./wallet-design/wallet-architecture.md).

```bash
bun install && bun run dev   # סקפולד בסיסי (עדיין לא הארנק)
```
