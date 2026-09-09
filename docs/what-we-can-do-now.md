# מה אנחנו יכולים לעשות עכשיו — הוכחות חיות ומסלול הכסף

> **תאריך מדידה: 2026-09-08 (UTC).** כל מספר במסמך זה נמדד חי בסשן זה, בשרת זה,
> מול mainnet ציבורי. כלום כאן לא הועתק מדו"ח קודם. מה שלא נמדד — מסומן ככזה.
> תחזיות פיננסיות מסומנות **speculative** — הן מודל עסקי, לא נתון.

> **עדכון סבב NET-AUDIT (אחר-צהריים, אותו יום):** ביקורת מלאה (DEX / packages /
> docs-vs-code) מצאה ותיקנה 14 באגים כולל שבירת-ממשק אמיתית בטאב MARKETS
> (`market-strip.tsx`), mid-price מה-ask הגרוע, עומק ×1000 שגוי, סיסמה ב-URL
> query, וטייפ שהציג מילויים ישנים כחדשים — והחזירה את המעבדה של Proof 2 לחיים
> (`tools/grid98-hydrate.ts`). 26 שגיאות-טייפ מוסתרות → **0**. פירוט מלא:
> **`docs/network-summary.md`** (מסמך-רשת לכל הסוכנים) + `worklog.md` NET-AUDIT.

---

## 1. מה הוכחנו — שלוש יכולות, שלוש הוכחות חיות (נמדדו היום)

### הוכחה 1 — Identity Anchor: מפתח אחד קושר Steem + Hive + EVM

**המבחן:** פוסט ל-`/api/saos/anchor-verify` עבור `headcorner` — השרת קורא את
פעולת ה-`custom_json` (`saos.id.v1`) האחרונה מהרשת, מריץ ecrecover על חתימת
EIP-191, ומשווה מול ה-authority החי על השרשרות.

**תוצאת המדידה של היום:**

| שדה | ערך נמדד |
|---|---|
| `ok` / `sameScalarProof` | **true / true** |
| anchor tx | `53e4c7e4db38ef45d6aecbf300948213a8390c40` · block **109,389,994** |
| זמן עגינה | 2026-09-08T04:00:24 (11 דקות לפני המדידה — זרימה שוטפת) |
| EIP-191 recovery | `0xF723186d21179672Ca6d9fc526Ffb718dbD99376` == claimed EVM ✔ |
| active key Steem | `STM5HhJD5WUXu8vPhDmLaC2fTuuJYkwxF62Rt17HZ5G2PbnBvuHXF` → נגזר **אותה כתובת EVM** ✔ |
| Hive | **אותם בייטים של מפתח** — נמדד חי מ-api.hive.blog ✔ |
| Blurt | **null מדווח בכנות** — כל נקודות ה-RPC לא נגישות מהרשת הזאת ברגע המדידה |

**משמעות:** scalar אחד של secp256k1 הוא בו-זמנית ה-authority החי על Steem, על
Hive, והבעלים של כתובת EVM — כשכל אחד יכול לאמת עם ecrecover בלי לסמוך עלינו.
זו לא הבטחה, זו מתמטיקה על נתוני on-chain ציבוריים, רצה ב-request-time.

**איפה רואים:** טאב PROOFS → Demo 1 (הזנת שם משתמש → VERIFY), קישור
"View on-chain" ל-steemworld, ו-`GET /api/saos/anchor-verify?username=...`.

---

### הוכחה 2 — Grid98: בנץ' חי, מדידה-חוזרת בכל ריצה

**המבחן:** `GET /api/saos/grid98-bench` מריץ את **מנוע ה-production האמיתי**
(`sovereign/node/grid98.cjs --bench`) על עותק state תושב שאותחל מהארכיון
(~43MB של `chain-archive.jsonl`), ומשחזר טרנזקציות ארכיון אמיתיות
דרך `kernel.applyTx` (ברירת-מחדל 20s, ניתן `?benchMs=5..60`).

**מדידה אחרונה (2026-09-08, ריצה של 10s לאחר החזרת המעבדה):**

| מדד | ערך נמדד |
|---|---|
| טרנזקציות משוחזרות | **2,322,825** ב-10.0s |
| קצב נמדד | **232,283 tx/s** |
| תקרת יכולת יומית | ≈20,069,251,200 tx/יום |
| log הרצה | `grid98 BENCH done · 2322825 txs in 10.0s` (מה-engine עצמו; BOOT · resident height=61,628 · orders=760 · poolsX=13) |

> **מספר ה-bench זז בכל ריצה** — קדמו לו 146,956 (20s, אותו יום) ו-183,998
> (ledger הדאימון). זו הנקודה: לא לצטט מהזיכרון אלא להריץ שוב
> (`curl /api/saos/grid98-bench`). מעבדה חסרה? `bun tools/grid98-hydrate.ts`
> (idempotent — מוריד sovereign/node+core+genesis מה-org + `steem@0.7.10`
> ל-agent/node_modules, ה-fallback המתועד במנוע עצמו) והבנץ' חי שוב.

**שערי-הכנות (הוכחת יושרה, לא תוצר-לוואי):**

| שער | ספירה מצטברת |
|---|---|
| `skippedForEdge` | **654,969** עסקאות שסורבו כי ה-edge לא כיסה עמלה+מינימום (מצטבר-חי; היה 401,084 בהדפסה הקודמת) |
| `rejected` | 136,982 (חי) |
| `edgeLeak` | 109,938µ — הדליפה הנמדדת מדווחת, לא מוסתרת |
| floor ladder | 9 מדרגות floor עם backing מתועד |

**השוואה (מסומנת בכנות בתשובת ה-API כ-reference ציבורי, לא המדידה שלנו):
Ethereum L1 ~15 tx/s · Solana (real-world) ~2,000–4,000 tx/s · Grid98 — המספר
החי למעלה.** ההערה הכנה של המנוע: זו תקרת מנגנון-שרשרת (`applyTx`-throughput);
קצב המסחר החי בפועל הוא תלוי-כלכלה ומדווח בנפרד — אנחנו לא מערבבים בין השניים.

**איפה רואים:** טאב PROOFS → Demo 2 → כפתור RUN LIVE BENCHMARK (15/30/60s),
השוואת-ברים חיה מול Ethereum/Solana, וספירות ה-honesty gates.

---

### הוכחה 3 — הצי: 13/13 חיילים חיים על Steem mainnet, פעילות בגובה דקות

**המבחן:** `GET /api/saos/fleet-status` מודד כל חשבון חי מול `condenser_api` +
`rc_api` (SP/VP/RC בנוסחאות steemd) ושולף את פעולת-on-chain החדשה ביותר של
כל חייל מ-account_history.

**תוצאת המדידה של היום (13/13 מעל רצפת RC של 10%):**

| חייל | תפקיד | SP | VP | RC | פעילות אחרונה |
|---|---|---|---|---|---|
| headcorner | commander | 8.6441 | 28.7% | 99.87% | 3 דק' · custom_json |
| cashmachine | trade | 0.0085 | 100% | 94.97% | 12 דק' |
| haran | trade | 0.3834 | 100% | 97.76% | 12 דק' |
| israelnews | trade | 0.0002 | 100% | 96.93% | 12 דק' |
| lsa | trade | 0.0076 | 100% | 95.84% | 11 דק' |
| macrame | trade | 0.0033 | 100% | 95.85% | 6 דק' |
| siq | trade | 0.0076 | 100% | 96.44% | 6 דק' |
| tov | trade | 0.0075 | 100% | 95.73% | 4 דק' |
| wic | trade | 0.0041 | 100% | 97.12% | 4 דק' |
| wog | trade | 0.0076 | 100% | 97.04% | 4 דק' |
| woq | trade | 0.0026 | 100% | 96.99% | 12 דק' |
| ynet | trade | 0.0045 | 100% | 100% | 125 דק' · transfer |
| powerspan | reserve | 0.0000 | — | 99.52% | 4,141 דק' |

הרצפה `ynet`/`powerspan` מוכיחה שזה לא staged: הצי אמיתי, עם קצבים שונים
וגם משתמש רזרבי — ובכל זאת כל ה-13 עם RC בריא (לולאת rc-heal עובדת).

**איפה רואים:** טאב PROOFS → Demo 3 — 13 כרטיסים עם רענון-אוטומטי כל 10 שניות;
לחיצה על חייל פותחת את 10 הפעולות האחרונות עם קישורי steemworld ציבוריים.

> דיוק מונחים: בטאב SAOS HUB מוצגות **19 שורות** = 13 חיילי Steem חיים **+ 6**
> חשבונות טבעת-TRON (מדידה נפרדת, מוצגת בכנות כטבעת נפרדת). "הצי" = 13.

---

## 2. ארבעה מודלים עסקיים — מה שנבנה כבר נמדד, ומה חסר כדי לגבות על זה

> **כל המספרים הפיננסיים בסעיף זה = speculative.** הם מודלי הכנסה תיאורטיים
> עם הנחות מפורשות. הם מסומנים כדי למנוע חיהוק של תחזית כאילו היא נתון.

### Model 1 — Cross-Chain Identity (Anchor-as-a-Service)

- **בעיה:** פרוטוקולי DeFi צריכים לקשר זהות משתמש בין EVM לבין שרשרות
  non-EVM (Steem/Hive קהילות של מיליוני משתמשים) בלי לסמוך על צד שלישי.
- **פתרון שכבר קיים אצלנו:** עגינת `saos.id.v1` + אימות ecrecover — חי ומוכח
  (הוכחה 1). ה-verification הוא pure-function: הקלט on-chain ציבורי, הפלט
  בוליאני עם דרך-אימות עצמאית.
- **נתיב הכנסה:** API בתשלום לאימות-זהות. תעריף דמה: $0.01/אימות → 10M אימותים/שנה = **$3.6M/yr (speculative — תלוי במכירות שעוד לא קיימות)**.
- **מה חסר בפועל:** אכיפה/מדידת-quota (API key + metering), לנדינג-פייג' עם
  ההוכחה, ו-3 לקוחות ראשונים. **לא נדרשת פריסת חוזה חכם.**

### Model 2 — HFT / Engine Infrastructure (Grid98-as-a-Service)

- **בעיה:** בוטים-מסחר זקוקים לתשתית order-matching מהירה וזולה עם שערים
  אכופים (מי שסוחר בלי edge — נדחה; ה-honesty gates מוכיחים את זה).
- **פתרון שכבר קיים אצלנו:** kernel שנמדד היום ב-**232,283 tx/s** (ריצה חייה אחרונה; המספר זז בכל ריצה — להריץ מחדש) עם
  401,084 סירובי-edge מצטברים כהוכחת משמעת (הוכחה 2).
- **נתיב הכנסה:** דמי-שימוש לבוט. תעריף דמה: $100–1,000/חודש/בוט → 500 בוטים
  ממוצע-$1,000 = **~$6M/yr (speculative)**.
- **מה חסר בפועל:** multi-tenant על ה-kernel (בידוד state לכל דייר), SLA,
  ודשבורד-חיוב. זה עבודת-הנדסה, לא המצאה.

### Model 3 — Fleet-as-a-Service (ניהול צי חיילים אוטונומי)

- **בעיה:** קרנות/עשירים רוצים פעילות on-chain אוטונומית (market-making,
  curation, delegation) בלי צוות 24/7.
- **פתרון שכבר קיים אצלנו:** 13/13 חיילים חיים על mainnet עם RC-heal, לופים
  מדודים, ופעילות שנמדדה בגובה דקות (הוכחה 3).
- **נתיב הכנסה:** דמי-ביצועים. תעריף דמה: 20% מהרווח על AUM של $100M =
  **$2M/yr (speculative — דורש AUM שלא קיים ורגולציה לא-מוסדרת עדיין)**.
- **מה חסר בפועל:** מסגרת משפטית, multi-sig על כספי לקוח, ו-track-record
  מדוד ציבורי (ה-dashboard כבר בנוי בשביל זה).

### Model 4 — Bridge (0.05% על נפח)

- **בעיה:** נזילות בין Steem-ecosystem לבין EVM/TRON.
- **פתרון שכבר קיים אצלנו:** 6 מסילות — 2 live (relay-steem עם עדות-txid,
  bridge-tron) + 4 gated בסיבות מפורשות (מ-`/api/bridge/status`, מדידה יומית).
- **נתיב הכנסה:** תעריף דמה: 0.05% על נפח $10M/יום = **$1.8M/yr (speculative)**.
- **מה חסר בפועל:** חוזה-גשר פרוס ב-EVM (ה-mint ממתין; ה-lock-op מוגדר) —
  החלטת-בעלים עם כסף אמיתי, כמו שנקבע ב-strategy-roadmap.

---

## 3. מה הכי קל להתחיל איתו — Model 1, בלי ויכוח

**למה דווקא:**

- ✅ **המנוע קיים ומוכח:** `/api/saos/anchor-verify` חי היום עם
  `sameScalarProof:true` (הוכחה 1) — אין לבנות כדי להתחיל למכור.
- ✅ **הוכחת-on-chain ציבורית:** tx `53e4c7e4db38ef45d6aecbf300948213a8390c40`
  ב-block 109,389,994 — כל אחד יכול לפתוח ב-steemworld ולאמת.
- ✅ **אפס פריסת חוזה, אפס כסף בסיכון:** האימות pure-function על נתוני
  mainnet. אין keys בסיכון, אין custody, אין רגולציה כבדה.
- ✅ **הטופולוגיה קיימת:** טאב PROOFS כבר מציג את ההוכחה בדפדפן — זה ה-demo
  sales שלך.
- ⏱️ **2–4 שבועות ל-API מסחרי · עלות: $0** (infra קיים ב-sandbox שלנו).

### תוכנית 4 שבועות (מ-היום)

**שבוע 1 — API מסחרי: ✅ שולם (2026-09-08, אותו יום).** חי בפועל:

- `POST /api/v1/identity/verify` — ה-product endpoint: `Authorization: Bearer
  saos_live_…`, מריץ את אותה אימות-אמיתית ומודד כל קריאה שבוצעה.
- מפתחות API: יצירה/שלילה דרך `/api/developer/keys` — ה-plaintext מוצג פעם
  אחת בלבד, ב-DB נשמר רק SHA-256; fail-closed מוכח (401 בלי מפתח, 401 אחרי
  שלילה — נמדד חי).
- Quota: 1,000 אימותים/מפתח/יום UTC (free tier) עם headers
  `X-RateLimit-Limit/Remaining/Reset`; כל קריאה שבוצעת נספרת כולל FAILED —
  השירות עשה עבודת-שרשרת אמיתית בכל מקרה (רשום בכנות ב-console).
- ספר-שימוש (usage ledger): כל קריאה = שורה (outcome PROVEN/FAILED/ERROR,
  username, latencyMs) + אנליטיקה ב-`/api/developer/usage`.
- Console למפתחים: טאב **DEVELOPER** בדשבורד — יצירת מפתח (copy-once),
  try-it חי (verdict + latency מדודה + quota), וגרף 24h. נבדק בדפדפן
  (desktop 1440 + mobile 390, אפס שגיאות קונסולה).
- מדידה חיה של יום-ההשקה: קריאה ממוסחרת עם מפתח אמיתי → `PROVEN`,
  latency 3,445ms, quota 1/1000; קריאה על חשבון לא-מעוגן → `FAILED` נמדד
  ונספר; מפתח שנשלל → 401. **(R2 עדכון: הענף 429 נשרף חי — `tools/m1-429-burn.ts`,
  1,031 קריאות SDK אמיתיות, 30×429, `SaosQuotaError.retryAt == X-RateLimit-Reset ==
  חצות UTC הבא`, fail-closed; `docs/m1-429-liveburn.md`.)**

> פער-כנות שנשאר משבוע 1: ה-console היא owner-side (בלי auth לניהול-מפתחות)
> כי ה-sandbox הוא מכונת-הבעלים; multi-tenant auth זה פריט שבוע 2+.

**שבוע 2 — SDK דק: ✅ הושלם באותו יום (2026-09-08).** חבילה
`packages/saos-id-verify/` — לקוח TypeScript רשמי, אפס תלויות, fetch טהור
(Node ≥18/Bun/Deno/דפדפן/edge):
- טיפוסים משוכפלים byte-for-byte מה-API החי (PROVEN @block 109,389,994 ·
  FAILED · 401) — union מטופס `VerifyProven | VerifyNotProven` + `rateLimit`
  מ-parsing של `X-RateLimit-*`.
- מחלקות שגיאה fail-closed: `SaosAuthError` (401) · `SaosQuotaError` (429,
  כולל `retryAt`) · `SaosApiError` · `SaosNetworkError`. `baseUrl` חובה —
  הלקוח מסרב להמציא endpoint.
- **בנייה הוכחה:** `tsc` strict → `dist/` (ESM + declarations) נקי.
- **דוגפוד חי דרך ה-SDK עצמו** (`tools/m1-w2-sdk-dogfood.ts`): PROVEN
  `sameScalarProof=true` @block 109,389,994, latency 4,127ms, quota 3→4
  (כולל FAILED שנספר בכנות), headers limit=1000/remaining/reset — ואז גם
  **הארטיפקט המקומפל** (dist) אומת חי: PROVEN + 401.
- אינטגרציה ב-console: טאב DEVELOPER → בלוק "OFFICIAL SDK" עם דוגמת
  3-השורות (מייצרת את ה-snippet עם ה-origin וה-username החיים).
- פער-כנות: `npm publish` בפועל היא פעולת-בעלים (דורשת credentials ל-registry);
  החבילה publish-ready (build+files+README). ~~הענף 429 לא-נשרף-חי~~ —
  **נשרף חי ב-R2 (ראו שבוע 1 למעלה).**

**שבוע 3 — Outreach ממוקד: 🟡 הוכן מלא באותו יום (2026-09-08); השליחה פעולת-בעלים.**
`docs/model1-week3-outreach.md` — עשרת היעדים נאספו מחיפוש-רשת אמיתי (11 שאילתות)
ונבדקו חי (כל דומיין מגיב): Splinterlands · MEXC · Gate · SimpleSwap · Changelly ·
Godex · Ecency · InLeo · PeakD · hive-bridge-eth (גשר wrapped-HIVE→EVM) — לכל אחד
וקטור-חשיפה מבוסס-snippet ציבורי + טיוטת-דוא״ל מותאמת (אב/CEX/משחקים/social-fi/גשר)
+ נספח-הוכחה שאפשר לשלוח ללקוח (עוגן ציבורי על steemworld + שחזור EIP-191 עצמאי +
curl עם מפתח-פיילוט). כנות: אין SMTP בסנדבוקס — השליחה ואיסוף-כתובות הן פעולות-בעלים;
BASE_URL ציבורי נדרש לפני פיילוטים.

**שבוע 4 — סגירת 3 לקוחות ראשונים (pilot חינם→מדוד):** metric הצלחה: 3
integrations חיות ששולחות ≥100 אימותים/יום. אם אין — מדווחים בכנות ולומדים
מה התנגדות השוק; התשתית לא נפגעת.

**UI overhaul — SAOS-first (2026-09-08, מיידי אחרי Week 3):** חשיפת-בעלים:
ה-UI עדיין נפתח כטרמינל STEEM/SBD (המחיר ב-header, STEEM כרטיס #1, SAOS-NET
כרטיס #5) — הופך: **SAOS היא הרשת, STEEM/SBD רק רכבת-עוגן.** שונה:
header חדש (wordmark SAOS + SOVEREIGN IDENTITY NETWORK, בלי טיקר STEEM/SBD)
· מסך-פתיחה `SAOS` עם hero: משפט-זהות + CTAs + ויטלים ריבוניים חיים
(height/checkpoints/bench/treasury/wrapped/pools) + **strip של checkpoint
anchors אמיתיים עם txids קליקים ל-explorer** (הראיה הכי חזקה שהייתה מוסתרת)
· Network Grid: SAOS-NET תמיד ראשון עם ״OUR CHAIN״ · 10→9 טאבים (REGISTRY
מוזגה ל-DEVELOPER; DEX→MARKETS עם pairs matrix) · כל 9 הטאבים במקלדת ·
footer/build: SAOS·SOVEREIGN·M3. אומת בדפדפן: golden path PROVEN
@block 109,406,462 דרך ה-CTA החדש, 9/9 טאבים נטענים, אפס שגיאות קונסולה,
מובייל 390px בלי גלילה-אופקית. אפס mock — הכל מה-apis הקיימים.

**קריטריון יציאה ל-Model 2:** אחרי 3 לקוחות חיים, הכסף מממן את multi-tenant
של Grid98 — באותה משמעת anti-mock.

---

## 4. נספח — איך מאמתים את המסמך הזה בעצמך (מבלי לסמוך עלינו)

```bash
# הוכחה 1 — זהות (pure math על on-chain ציבורי):
curl -s -X POST http://localhost:3000/api/saos/anchor-verify \
  -H 'Content-Type: application/json' -d '{"username":"headcorner"}' | jq '.verify'

# הוכחה 2 — ביצועים (מריץ את ה-engine האמיתי; לוקח ~35 שניות):
curl -s http://localhost:3000/api/saos/grid98-bench | jq '.run, .gates'

# הוכחה 3 — הצי (מדידות condenser/rc_api חיות):
curl -s http://localhost:3000/api/saos/fleet-status | jq '.statusLine, .soldiers'

# וכן: סנאפשוט ה-סטאק הריבוני כולו:
curl -s http://localhost:3000/api/saos/hub | jq '.ok, .fetchedAt'
```

**וה-product (שבוע 1, חי):** צרו מפתח בטאב DEVELOPER (או:)

```bash
ADMIN=$(curl -s -X POST http://localhost:3000/api/developer/admin/bootstrap | jq -r '.token // empty')
# (bootstrap מחזיר פלטנקט פעם-אחת בלבד; אחר-כך: Authorization: Bearer <admin token>)
KEY=$(curl -s -X POST http://localhost:3000/api/developer/keys \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN" \
  -d '{"name":"self-check"}' | jq -r .key)
curl -s -X POST http://localhost:3000/api/v1/identity/verify \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"username":"headcorner"}' | jq '.ok, .verify.sameScalarProof, .meta'
curl -s http://localhost:3000/api/developer/usage | jq '.totals, .last24h'
```

ובדפדפן: **טאב PROOFS** — שלושת ה-demos לחיצים ומריצים עכשיו; **טאב
DEVELOPER** — ה-API המסחרי המדוד (מפתחות + try-it + ledger).

---

## SOVEREIGN MODE — חמשת הפריטים הפתוחים נסגרו חי (2026-09-08, סבב שלישי)

כל הפריטים ה"אפשריים-עכשיו בסנדבוקס" מ-`network-summary.md §6` בוצעו, עם
הוכחה חיה לכל אחד (Zero-Mock — כל מספר מהריצה בפועל):

| # | פריט | מה נעשה | הוכחה חיה |
|---|------|---------|-----------|
| 1 | **מכסה אטומית** | `QuotaCounter` — upsert מותנה אחד (`INSERT..ON CONFLICT..DO UPDATE..WHERE used<limit` + `RETURNING`) סוגר את ה-off-by-one שנמדד ב-burn | `tools/quota-race-test.ts` — 1,050 הזמנות מקבילות: בדיוק 1,000 אישורים, 50 דחיות, overshoot **0**, אפס double-spend (`ATOMIC-PROVEN` 7/7) |
| 2 | **ZK מחובר** | `zkCommitment` (Schnorr Fiat–Shamir) נקבע ב-init ונבדק ב-unlock + שתי נקודות ה-step-up — מאמת עצמאי שני ל-Argon2id | `tools/vault-zk-check.ts` 9/9 `ZK-WIRED-PROVEN`: זיהוי-שחיתות דו-כיווני, קשירת-context נגד replay, fail-closed על commitment חסר |
| 3 | **Auth ל-console** | `POST /api/developer/admin/bootstrap` (copy-once) + `requireAdmin` על create/revoke מפתחות; `SAOS_ADMIN_TOKEN` מנגלה | חי: 401 ללא-token, 201 מאומת, bootstrap שני לא מחזיר פלטנקט, revoke מאומת עובד |
| 4 | **ENERGY — הכרעה** | האינווריאנט תוקן להיגיון הבטיחות האמיתי: supply>locked = קריטי (over-issue); supply<locked = ה-posture המתוכנן של ה-daemon (cover ≥101%, `bridgeMintTxs` מטריח 0.99·locked) | `/api/system/health`: 20 נכסים, ENERGY cover 1.010101 ok:true, criticalIssues 0; מעודכן ב-system-status |
| 5 | **ולידציית account מאוחדת** | `src/lib/account-name.ts` — חוקי steemd המלאים (סגמנטים ≥3, התחלה a-z, סיום a-z0-9) בשני הפאנלים במקום ה-regex הרופף | tsc/lint נקי; שם-שגוי מקבל סיבה מדויקת ב-UI במקום דחיית-שרת |

**אירוע חי — AUTHORITY DRIFT (21:17 UTC):** בזמן הסבב חל `account_update_operation`
על headcorner (blk 109,410,651) — ה-active authority הוחלף. ה-anchor החדש-ביותר
(18:28) חתום ע"י ה-scalar הקודם, ולכן ה-API מחזיר FAILED **נכון וכנה** — זו בדיוק
ההבטחה של המוצר: סטיית-סמכות נתפסת. ה-verifier שודרג לדווח `AUTHORITY DRIFT`
במפורש עם שני הכתובות + הבלוק של ה-anchor. עד שה-fleet תפרסם anchor חתום
מהמפתח החדש (פעולת-בעלים/חוצה-תיקיות), ה-golden path מציג את ה-FAILED הכנה.

**re-burn של ה-429 חסום זמנית** ע"י אירוע ה-drift (ה-tool fail-closed לפי
עיצוב) — הוכחת האטומיות עומדת על `quota-race-test` (אותו `reserveQuota` שמופעל
ב-HTTP) + חשבון-מכסה מדויק חי (`used:1 remaining:999` ב-probes).

---

## SEC-HARD — אבטחה בסביבה-מחוברת (2026-09-08, סבב רביעי)

**ההנחיה:** "מחוברים לרשת → לחזק אבטחה, לוודא שלא נקרא/נעשה שימוש בקוד זדוני."
**הכל נמדד חי, והשער מכני: `bun tools/security-audit.ts` → 23/23 PASS (exit 0).**

- **שרשרת-אספקה נבדקה חי:** `npm audit` מול DB-הייעוץ החי → **0 פגיעויות** בכל
  עץ-התלויות; `bun.lock` נעול ב-git; **0 lifecycle-scripts** ב-6 package.json
  (אין ריצת-קוד בזמן-install); ה-SDK הרשמי `saos-id-verify` נשאר **אפס-תלות**
  (נאכף מכנית).
- **קוד זדוני — אין, וזה נאכף:** סריקת `eval`/`new Function`/`child_process`/
  `dangerouslySetInnerHTML` על כל `src+packages+tools` → שתי ההיתרים היחידים
  (runner-המנוע המקומי בנתיב-קבוע; מזריק-CSS של chart) מתועדים ונבדקים מכנית,
  כולל assertion שנתיב-ה-spawn נשאר `.grid98-lab` מקומי.
- **secrets — אין ב-git:** 0 קבצי .env/.pem/keystore; 0 דפוסי WIF/PEM/מפתחות
  בקבצי-טקסט נעקבים; מפתחות-probe נשללו; אישור-מנהל reset ל-owner-first.
- **HTTP חוזק:** CSP (`default-src 'self'` + דוקומנטציה-כנה של ההקלות), nosniff,
  Referrer-Policy, Permissions-Policy, HSTS, `X-Powered-By` כבוי — חי בכל
  תשובה; **0 הפרות-CSP בדפדפן** ו-HMR חי.
- **rate-limits חדשים + הוכחות-429 חיות:** `grid98-bench` 3/min (spawn יקר —
  חי: 3×200 ואז 429+Retry-After); `anchor-verify` 10/min (proxy חיצוני — חי:
  10×200 ואז 429); ה-limit אף תפס זרימת-משתמש אמיתית מה-UI בזמן-הבדיקה.
- **דפדפן אחרי-החיזוק:** golden path PROVEN חי, אפס שגיאות/הפרות, 390px
  ו-1440px אפס-גלילה אופקית.
- מסמך-האם: `docs/security.md` (מודל-איום · מדיניות-שרשרת-אספקה · מפת
  rate-limits · מדיניות-secrets · תגובה לתקריות · פערים-כנים).

---

*המסמך נכתב אחרי הרצת כל שלושת ה-apis בסשן זה (2026-09-08). מספרים
עתידיים/פיננסיים מסומנים speculative ולא מהווים נתון. כנות > שיווק.*

## EVM-ANCHOR — החתימה בוצעה בפועל (2026-09-09, סבב חמישי)

**ההנחיה:** "יש לך חתימה באחת התיקיות — תבצע, אני מרשה לך."
**החתימה נמצאה (registry-fleet שנגזר 01:14), בוצעה, וקבועה על Ethereum mainnet.**

- **txid חי:** `0xf5c48cdefe1c1448728c6d5828f34d8393cabc25ed9ab702e318c85bf46d584a`
  · בלוק 25,936,661 · status 1 · gasUsed **32,680 == החיזוי המדויק של מודל
  EIP-7623** · חותם: ארנק headcorner הריבוני · עלות ~$0.012.
- **מה נקבע לנצח:** מצב השרשרת הריבונית — height 68,058 · stateRoot
  `94efe479…` · 64 checkpoints — תחת **חמישה שעוני-שרשרת עצמאיים**
  (STEEM · HIVE · TRON · ETHEREUM · SOLANA) שנקראו חי ברגע-החתימה.
- **המסלול:** פרוטוקול `saos-jumpper/v1` (self-transfer EOA, value=0,
  commitment ב-calldata) — נחתם מקומית דרך ה-adapter הקיים, נשלט fail-closed
  (שומר-תקציב 20%, שומר-signer, `--broadcast` מפורש).
- **אימות חוזר לכל אחד:** `bun tools/evm-anchor-broadcast.ts --verify=<txid>`
  → TIER-3-VERIFY: PROVEN · או ידנית: Etherscan → Input Data → JSON קריא.
- **כנות:** מפתחות-STEEM עדיין ישנים מול הרוטציות (40/40 MISMATCH — נבדק
  מכנית ב-`tools/vault-authority-check.ts`); anchors בצד-STEEM חסומים עד
  סנכרון-מפתחות מהבעלים. ה-anchor החוזר הוא החלטת-בעלים — הכלי מוכן.
- מסמך-הראיה המלא: `docs/evm-anchor-round.md`.

---
