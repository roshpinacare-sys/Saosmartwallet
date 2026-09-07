# Saosmartwallet — ארנק פורץ-דרך לרשת ממשפחת Steem

> **סטטוס: M0+M1 מומשו ואומתו מול ה-chain · keystore/policy ממתינים ל-M2**
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
| [`packages/core/`](./packages/core/README.md) | Keystore AES-256-GCM + Policy Engine | ⬜ M2 |
| `tools/serialize-test.ts` | סוויטת אימות מול chain חי | ✅ **30/30 PASS** |
| `tools/m1-op-test.ts` | סוויטת limit_order_create מול oracle | ✅ **27/27 PASS** |

**קריטריוני קבלה שעברו מול ה-chain האמיתי** (קריאה-בלבד): serialization **זהה ביט-אחר-ביט** ל-serializer של הצומת עצמו (10/10 עסקאות) · sha256 על ה-bytes שלנו = `transaction_id` מה-chain (10/10) · חתימות אמיתיות מה-chain משוחזרות בדיוק למפתחות ה-authority של החותם — הוכחת מסלול חתימה מלא בלי שידור.

**לקחים אמפיריים שנתגלו ותוקנו בזכות אימות מול bytes אמיתיים** (מתועדים ב-README של packages/chains/steem): שדה Asset הוא 16 בייטים (לא 15/14) · checksum של "STM" הוא `ripemd160(pub)` ישירות · header חתימה = 31+recid · `condenser_api` דורש פרמטרים מערכיים.

```bash
bun tools/serialize-test.ts --rpc https://api.steemit.com --samples 10   # הוכחה חוזרת (קריאה-בלבד)
bun tools/chain-health-check.ts --rpc https://api.steemit.com           # בדיקת תקינות צומת
bun tools/m1-op-test.ts                                                # M1: limit_order_create מול oracle
```

## 🖥️ M1 DEX Terminal — מומש ואומת חי (2026-09-07)

שכבת האפליקציה חיה: **טרמינל מסחר לשוק הפנימי STEEM/SBD** עם נתוני chain חיים בלבד (אפס mock data).

| נכס | תיאור | סטטוס |
|---|---|---|
| `src/app/page.tsx` | SAOSMART TERMINAL — dark-only, Bloomberg×Cyberpunk (glassmorphism, mono numbers, Framer Motion) | ✅ חי |
| Order Book + Tape | ספר פקודות חי (get_order_book) + fills (get_trade_history) עם depth bars ואנימציות | ✅ חי מול הצומת |
| Trading Terminal | בונה limit_order_create: BigInt math → adapter → serializer → preview (hex + digest + tx_id) | ✅ bit-exact מול oracle |
| Wallet Dashboard | יתרות STEEM/SBD/SP (המרת VESTS בשלמים), מד RC, פקודות פתוחות | ✅ חי |
| `/api/steem/*` | 5 routes שעוטפים את ה-adapter/client מ-M0/M1 — ללא מפתחות, ללא שידור | ✅ |
| `packages/chains/steem/src/market.ts` | SteemMarketClient (קריאה-בלבד): orderbook/ticker/history/dgp/open-orders | ✅ |
| `tools/m1-op-test.ts` | limit_order_create מול get_transaction_hex (3 וקטורי oracle) | ✅ **27/27 PASS** |

**ראיית קצה:** פקודה שנבנתה דרך ה-API (BUY 100 STEEM @ 0.098) חזרה **bit-exact** מול serializer הצומת — אומת ב-wire ב-2026-09-07. באג M0 שהתגלה ב-M1 ותוקן: `max_rc` ברמת החשבון (לא בתוך rc_manabar).

**שער בטיחות נשמר:** הטרמינל בונה, מסדר ומאמת — חתימה נעולה עד keystore (packages/core, M2); broadcast fail-closed.

```bash
bun run dev   # הטרמינל חי על / — נתונים חיים מ-api.steemit.com
```

## 🌐 SAOS GRID — Ecosystem Command Center (2026-09-07)

המסך הראשי הפך ל**מרכז-שליטה לכל האקוסיסטם** — סריקה מלאה של 8 הריפו של `roshpinacare-sys` (GitHub API: trees, READMEs, state files חיים) + 5 רשתות שנבדקות חי בכל רענון. אפס mock data: רשת שנופלת מוצגת בכנות כ-offline.

| טאב | תוכן | מקור נתונים (חי) |
|---|---|---|
| **GRID** | KPI strip · Network Grid (5 כרטיסי רשת + drill-down) · Pairs Matrix (sortable, כל ה-venues) | probes חיים לכל השרשראות |
| **DEX** | Order Book + Trading Terminal + Tape — השוק האמיתי STEEM/SBD | api.steemit.com (M0/M1) |
| **SAOS-NET** | מנוע הרשת הריבונית שלנו: bench 130K tx/s, treasury P&L, הספר-הריבוני, ציטוטי oracle חתומים, wrapped assets, delegations | `state.json` + `grid98-state.json` (daemon-push ל-repo `steem`) |
| **BRIDGES** | מטריצת עוגנים (STEEM 🟢/HIVE ⏳/BLURT ⏳/TRON 🟢) + Live Anchor Feed עם txids אמיתיים + attests | SAOS-NET checkpoints |
| **REGISTRY** | 8 ריפו · שירותים · פערים כנים (מה חסר: adapters ל-Hive/Blurt/TRON, keystore M2) | סריקה 2026-09-07 |
| **WALLET** | יתרות/SP/RC/פקודות פתוחות — מעקב חשבון חי | api.steemit.com |

**מקורות חיים:** `api.steemit.com` · `api.hive.blog` (+fallbacks) · `rpc.blurt.world`/`saboin` (+fallbacks) · `api.trongrid.io` · daemon-state של SAOS-NET (גובה 52,000+, 1,112 checkpoints מאומתים, oracle חתום-שעתי). כל ה-probes עם TTL cache בצד-השרת — כבוד ל-rate-limits.

**קיצורי מקלדת:** מקשים 1–6 מחליפים מסכים.

### 🎨 Enterprise redesign (2026-09-07) — design system מקצועי מלא

ה-UI נבנה מחדש מאפס ברמת Bloomberg Terminal / TradingView / dYdX — לא שיפור של הקיים, בנייה מחדש גמורה. שכבת הנתונים (packages, hooks, API routes) נותרה נעולה וללא שינוי.

| שכבה | תוכן |
|---|---|
| **Design tokens** (`globals.css`) | צבעים סמנטיים (success `#10b981` / danger `#ef4444` / warning `#f59e0b` / info `#3b82f6` / saos `#8b5cf6`), 4 שכבות רקע, hairline borders ב-3 עוצמות, gradients, elevation shadows (4 מדרגות), סקאלת typographic מודולרית, גריד 8px — הכל CSS variables; Inter (UI) + JetBrains Mono (כל מספר, tabular figures) |
| **Glassmorphism אמיתי** | `blur(12px) saturate(180%)` + inset top-light; כרטיסים אינטראקטיביים עם gradient-border glow (mask-composite) + lift ב-hover |
| **Motion** (`motion-bits.tsx`) | `AnimatedNumber` — tween דרך MotionValue (עדכון DOM ישיר, אפס re-render לפריים); `FlashValue` — הבזק ירוק/אדום בכל tick; `Delta` — שבבי אחוז; `useRollingHistory` — ring buffer חיצוני (useSyncExternalStore) שדוגם ערכים חיים לספארק-ליין (נתוני session אמיתיים, לא סינתטיים) |
| **Charts** (`charts.tsx`) | `Sparkline` — מיקרו-גרף עם gradient fill לכל כרטיס רשת/KPI; `DepthChart` — עומק צבירה אמיתי (bids ירוק משמאל, asks אדום מימין, tooltip, ציר מחיר) לספר ה-STEEM/SBD ולספר הריבוני |
| **Data-viz בכל מסך** | KPI strip (6 כרטיסים + ספארק), כרטיסי רשת עם ספארק גובה חי, leaderboard עם bars מונפשים, RC manabar gradient, skeleton shimmer בכל טעינה |
| **A11y** | aria-labels לכל הטאבים (כולל רמז מקלדת), role/labels למדדים, focus-visible rings, `prefers-reduced-motion` כבוי-אנימציות, HTML סמנטי (header/main/section/footer) |

**אימות דפדפן (agent-browser):** אפס שגיאות קונסולה אחרי תיקון duplicate-keys (TabsContent לא-keyed בתוך AnimatePresence) + תיקון פורמט ווליום (`steemVolumeSatoshis/1000` במקום regex על מחרוזת). Golden path אומת מקצה לקצה: לחיצה על מחיר בספר → prefill + היפוך צד → build → דיאלוג payload/envelope/hex/digest + tx_id 60 בייטים. 6 טאבים נבדקו ויזואלית בדסקטופ 1440px ומובייל 390px; קיצורי 1–6 עובדים; footer דביק בשני המסכים.

```bash
bun run dev   # ה-Grid חי על / — כל הרשתות נבדקות חי בכל רענון
```

## 🔐 הערות אבטחה למאגר זה

- `.env` ו-`upload/` **אינם חלק מההיסטוריה** (נוקו לפני ה-push הראשון) ומוחרגים ב-`.gitignore`.
- טוקן ה-GitHub ששימש ל-push אינו מאוחסן במאגר ואינו מצוטט בשום מסמך; מומלץ לצמצם את היקפו/לשלולו לאחר השימוש.

## 🛠️ הסקפולד במאגר

המאגר כולל סקפולד Next.js 16 + TypeScript (App Router, Prisma/SQLite, shadcn/ui) — בית עתידי ל-`apps/web-wallet` לפי הארכיטקטורה. מבנה המונורפו המתוכנן: [`wallet-architecture.md` §3](./wallet-design/wallet-architecture.md).

```bash
bun install && bun run dev   # סקפולד בסיסי (עדיין לא הארנק)
```
