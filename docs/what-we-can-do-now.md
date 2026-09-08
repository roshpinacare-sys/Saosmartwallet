# מה אנחנו יכולים לעשות עכשיו — הוכחות חיות ומסלול הכסף

> **תאריך מדידה: 2026-09-08 (UTC).** כל מספר במסמך זה נמדד חי בסשן זה, בשרת זה,
> מול mainnet ציבורי. כלום כאן לא הועתק מדו"ח קודם. מה שלא נמדד — מסומן ככזה.
> תחזיות פיננסיות מסומנות **speculative** — הן מודל עסקי, לא נתון.

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

### הוכחה 2 — Grid98: 146,956 tx/s נמדדו עכשיו, עם שערי-כנות

**המבחן:** `GET /api/saos/grid98-bench` מריץ את **מנוע ה-production האמיתי**
(`sovereign/node/grid98.cjs --bench`) על עותק state תושב שאותחל מהארכיון
(39,816,230 בייטים של `chain-archive.jsonl`), ומשחזר טרנזקציות ארכיון אמיתיות
דרך `kernel.applyTx` במשך 20 שניות.

**תוצאת המדידה של היום:**

| מדד | ערך נמדד |
|---|---|
| טרנזקציות משוחזרות | **2,939,116** ב-20.0s |
| קצב נמדד | **146,956 tx/s** |
| תקרת יכולת יומית | 12,696,998,400 tx/יום |
| log הרצה | `grid98 BENCH done · 2939116 txs in 20.0s` (מה-engine עצמו) |

**שערי-הכנות (הוכחת יושרה, לא תוצר-לוואי):**

| שער | ספירה מצטברת |
|---|---|
| `skippedForEdge` | **401,084** עסקאות שסורבו כי ה-edge לא כיסה עמלה+מינימום |
| `rejected` | 130,499 |
| `edgeLeak` | 109,919µ — הדליפה הנמדדת מדווחת, לא מוסתרת |
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
- **פתרון שכבר קיים אצלנו:** kernel שנמדד היום ב-**146,956 tx/s** עם
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
  ונספר; מפתח שנשלל → 401. (הערת-כנות: הענף של 429 quota-exhausted לא
  נוסה חי — דורש 1,000 קריאות בפועל; ההיגיון נבדק בקוד.)

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
  החבילה publish-ready (build+files+README). הענף 429 נשאר לא-נשרף-חי, כמו
  בשבוע 1.

**שבוע 3 — Outreach ממוקד:** רשימה של 10 פרוטוקולי DeFi שיש להם חשיפה
למשתמשי Steem/Hive (עסקאות curation, משחקים, social-fi) — לכל אחד דוא"ל אחת
עם קישור להוכחה החיה (לא מצגת — ה-demo שלנו).

**שבוע 4 — סגירת 3 לקוחות ראשונים (pilot חינם→מדוד):** metric הצלחה: 3
integrations חיות ששולחות ≥100 אימותים/יום. אם אין — מדווחים בכנות ולומדים
מה התנגדות השוק; התשתית לא נפגעת.

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
KEY=$(curl -s -X POST http://localhost:3000/api/developer/keys \
  -H 'Content-Type: application/json' -d '{"name":"self-check"}' | jq -r .key)
curl -s -X POST http://localhost:3000/api/v1/identity/verify \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"username":"headcorner"}' | jq '.ok, .verify.sameScalarProof, .meta'
curl -s http://localhost:3000/api/developer/usage | jq '.totals, .last24h'
```

ובדפדפן: **טאב PROOFS** — שלושת ה-demos לחיצים ומריצים עכשיו; **טאב
DEVELOPER** — ה-API המסחרי המדוד (מפתחות + try-it + ledger).

---

*המסמך נכתב אחרי הרצת כל שלושת ה-apis בסשן זה (2026-09-08). מספרים
עתידיים/פיננסיים מסומנים speculative ולא מהווים נתון. כנות > שיווק.*
