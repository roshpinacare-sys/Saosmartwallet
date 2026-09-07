# Saosmartwallet — ארנק פורץ-דרך לרשת ממשפחת Steem

> **סטטוס: עיצוב הושלם (מסמכים) · פיתוח ממתין לאישור רשת היעד (שער M0)**
> עדכון אחרון: 2026-09-07 (Asia/Jerusalem)

מאגר זה מכיל את עיצוב המוצר והארכיטקטורה המלאים עבור **Saosmartwallet** — ארנק self-custodial שמנצל את התכונות הייחודיות של רשת ממשפחת **Steem** (היררכיית מפתחות owner/active/posting/memo · עסקאות ללא עמלות דרך Resource Credits · הצפנת memo נייטיב · ממשל מובנה), במקום לחקות ארנקי EVM.

⚠️ **הצהרת תקפות:** העיצוב מותנה ב**הנחת עבודה מסומנת** — שרשת היעד היא ממשפחת Steem (Steem/Hive). ההנחה מבוססת על הקשר השיחה בלבד; **לא נמצא קוד רשת בסביבה לאימות** (אומת ב-3 סריקות עצמאיות). הליבה תוכננה network-agnostic כדי לשמר את ההשקעה גם אם הרשת המדויקת תשתנה.

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

## 🔐 הערות אבטחה למאגר זה

- `.env` ו-`upload/` **אינם חלק מההיסטוריה** (נוקו לפני ה-push הראשון) ומוחרגים ב-`.gitignore`.
- טוקן ה-GitHub ששימש ל-push אינו מאוחסן במאגר ואינו מצוטט בשום מסמך; מומלץ לצמצם את היקפו/לשלולו לאחר השימוש.

## 🛠️ הסקפולד במאגר

המאגר כולל סקפולד Next.js 16 + TypeScript (App Router, Prisma/SQLite, shadcn/ui) — בית עתידי ל-`apps/web-wallet` לפי הארכיטקטורה. מבנה המונורפו המתוכנן: [`wallet-architecture.md` §3](./wallet-design/wallet-architecture.md).

```bash
bun install && bun run dev   # סקפולד בסיסי (עדיין לא הארנק)
```
