# סיכום רשת מקיף — תיקיית saos-terminal (הדשבורד/טרמינל)
**תאריך:** 2026-09-08 · **commit:** `db82607` → (מעליו: סבב NET-AUDIT-R2) · **נכתב עבור:** כל הסוכנים על הרשת — זה החומר של התיקייה הזאת, מה הושג, מה נמצא בביקורת, ומה הצעדים הקריטיים הבאים.

> **סבב R2 (אותו יום):** כל סעיפי "הלאה" של הסבב הקודם בוצעו — כולל סגירת מחזור החיים של ה-DEX (limit_order_cancel עם אורקל חי), live-burn ל-429, multi-hop ב-router, והקשחת בריאות. הסעיפים כאן מעודכנים למצב אחרי R2.

---

## 1. מה התיקייה הזאת בכלל

זו **תחנת הבקרה של הרשת** — Next.js 16 + TypeScript + Prisma/SQLite, רצה בדפדפן עם UI חי אחד (9 טאבים SAOS-ordered: SAOS · SAOS HUB · PROOFS · SAOS-NET · MARKETS · BRIDGES · WALLET · VAULT · DEVELOPER). היא:

- **מוכיחה את הזהות** — מנוע אימות EIP-191/base58check חי: סקלר secp256k1 אחד = מפתח-active של Steem + Hive + כתובת EVM (`sameScalarProof:true`, בלוקים חיים, לינקים ציבוריים ל-steemworld).
- **מוכרת את הזהות** — API מדוד `POST /api/v1/identity/verify` (מפתחות `saos_live_`, SHA-256-only, מכסה 1,000/יום UTC, headers `X-RateLimit-*`, usage ledger מלא) + **SDK רשמי** `saos-id-verify` (zero-dep, dist מוכח חי).
- **מציגה את השרשרת שלנו** — SAOS-NET חי מדאימון: גובה ~61.6K, 64 checkpoints, ~1,868 anchors verified, רצועת anchors לחיצה עם txids ציבוריים.
- **מנהלת את הכסף** — כספת ריבונית M2 (Argon2id, AES-256-GCM, Shamir, dead-man, Policy Engine, audit hash-chain, חתימה+broadcast מדונים).
- **מפעילה DEX אמיתי** — ספר פקודות STEEM/SBD חי מהרשת, בניית limit_order_create ב- BigInt, חתימה+שידור דרך הכספת.
- **מגשרת** — 6 גשרים: 2 חיים (STEEM relay + TRON), 4 gated עם סיבות כנות, מנוע מסלולים עם עמלות ETH חיות.
- **מריצה את מנוע המיקרו-גריד** — grid98.cjs האמיתי (מה-org) נמדד חי דרך `/api/saos/grid98-bench`.

## 2. מה הושג (נמדד חי היום, לא מהדורות קודמות)

| הישג | הוכחה חיה (2026-09-08) |
|---|---|
| זהות חד-סקלרית | `anchor-verify?username=headcorner` → `sameScalarProof:true`, steem=SAME hive=SAME, blurt=null מנומק |
| API מדוד | 5 keys / 9 calls ב-ledger; 401 fail-closed בלי key; FAILED נמדד ביושר |
| SDK | PROVEN דרך קוד המקור + dist; 401 דרך `SaosAuthError` |
| Fleet | **13/13 חיילים מעל רצפת RC** (99.5–100%), כולל האיטיים הכנים (ynet 972 דק') |
| Wrapped | 20 נכסים — supply==locked 1:1 **חוץ מ-ENERGY 49.5≠50 (Δ −0.5) — ממצא-דאימון אמיתי, מדווח critical ב-health עד הכרעת בעלים** (WSTEEM 632=632, WBLURT 64.227=64.227 ✓) |
| Floor ladder | 9 מדרגות 0.01688→0.017567, אחרונה גיבוי 123,244µ |
| גשרים | relay-steem חי (cp#61608 → txid), TRON חי (4 anchors, 6/6 כתובות), 4 gated כנים |
| **מיקרו-גריד** | **המעבדה חיה + bench רץ-חוזר מה-UI: 232,283 tx/s (הידרציה) → 189,518 tx/s בריצה-חוזרת חיה** (2.2M txs אמיתיים/10s) — המנוע האמיתי, מ ledger אמיתי, עם דלתא previous-vs-new |
| בריאות | 7/7 רשתות UP · 2 rails חיים · **wrappedInvariant חי (תפס ENERGY 49.5≠50 → critical כנה)** |
| DEX | **מחזור חיים סגור: create → open orders → cancel, cancel אורקל-חי זהה-בית (node serializer), 4/4 ALL PASS** |
| מדידה | **429 live-burn: 1,031 קריאות, retryAt==Reset==חצות UTC, fail-closed** |
| גשרים | relay-steem חי (cp#61608 → txid), TRON חי (4 anchors, 6/6 כתובות), **multi-hop חי: steem→tron 2-רגלי LIVE**, 4 gated כנים |

## 3. הביקורת המלאה (NET-AUDIT) — מה נמצא ומה תוקן

שלוש מעבדות ביקורת מקבילות: DEX-layer, packages/bridges, docs-vs-code. **26 שגיאות טייפ** היו מוסתרות מאחורי `ignoreBuildErrors` — כולן סגורות עכשיו (`tsc --noEmit` = 0 מחוץ ל-examples/skills).

### תוקן היום (הדם היה אמיתי)
1. **`market-strip.tsx:43` — `}, arket]);`** — טיפו-השחתה ששבר את ה-MARKETS טאב (cached build הסתיר אותו). תוקן + גם `ask−bid` על strings → חיסור מספרי.
2. **Order book: mid-price מה-ask הגרוע** (`asksView[len-1]` במקום `[0]`) — ה-mid היה נסחר מנופח.
3. **Depth chart ×1000 שגוי** — sats בדיוק-3 חולקו ב-1e6 במקום 1e3; הטולטיפ הציג 0.01 STEEM במקום 5,000.
4. **הפרדת פקודת-מכירה חתומה ≠ מה שהמשתמש אישר** — `signRequestFromPreview` עשה round-trip דרך `effectivePrice` (איבוד סאטושי); עכשיו המחיר שהמשתמש הקליד עובר verbatim ל-sign rebuild.
5. **הטייפ יכול היה להציג מילויים ישנים כחדשים** — הוכח חי: הצומת מאפשר רק איטרציה עולה ב-get_trade_history (יורד → 0 תוצאות). הרואט מביא 1,000 מ-limflow וחותך את החדש בעצמו.
6. **סיסמת step-up ב-URL query** (`DELETE /api/vault/keys?password=`) — עברה ל-body (ה-hook כבר שלח body — **wire-mismatch אמיתי** שהיה שובר ביטול-מפתח מה-UI).
7. **Tautology ב-orchestrator** (`Date.now() < lockUntil` שרק נוצר) — הוסר, ה-THROW נשאר זהה בהתנהגות.
8. **`amountToSats` שבור** (regex לא-חוקי `\d{1,\d+}`) — תוקן (היה dead, עכשיו גם נכון).
9. **recoverPublicKey 2-arg** (API של @noble/curves השתנה) — תוקן ב-4 אתרים (keys.ts ×2, serialize-test ×2).
10. **balance validation fail-open** — בניית פקודה עכשיו דורשת wallet `isSuccess`.
11. **Non-JSON responses קורסים** — getJson עם try/catch + הודעות שימושיות.
12. **bridge-monitor הציג סטטי מ-2026-09-07** — עכשיו חי מ-`/api/bridge/status` עם fallback מוצהר.
13. **Staleness UX** — "book Xs old"/"tape Xs old" + badge עובר STALE אחרי 2× poll.
14. **health route עמיד** — probe קורס לא מוריד את כל ה-endpoint.

### חוזר לחיים (מה שהדוקומנטים הבטיחו ולא עבד)
- **`.grid98-lab` לא היה קיים** — `curl /api/saos/grid98-bench` החזיר ok:false. נוצר **`tools/grid98-hydrate.ts`** (idempotent): מוריד את sovereign/node + core + genesis מה-org (read-only) + `steem@0.7.10` ל-agent/node_modules (ה-fallback המתועד במנוע עצמו). **הבנץ' חי שוב** — ההוכחה למעלה.

### נמצא ופתוח (ממתין החלטת בעלים או סבב הבא)
- **ZK מודול (core/crypto/zk.ts)** — מתמטיקה אמיתית (Fiat–Shamir Schnorr על secp256k1), אפס קוראים. לחבר ל-init/unlock או להוריד מה-barrel.
- **multi-hop hub routing מת** (`router.ts:221` דורש rail עם `target==="saos-net"` שלא קיים) — נדרש reverse-leg.
- **limit_order_cancel לא ממומש** — ה-op מוגדר, ה-wizard מבטיח אותו, ה-pack/unpack חסר (~20 שורות + כפתור בטבלת פקודות פתוחות).
- **`ignoreBuildErrors: true` ב-next.config** — מסתיר שגיאות עתידיות; עכשיו אפשר לכבות (0 שגיאות).
- דד-קוד: `bridges/index.ts` barrel, `getSteemAdapter/getAllAdapters`, `ERC20_ABI` (ה-READ בשימוש), `toRpcCommitment/COMMITMENT_LEVELS/NATIVE_MINT`, `CryptoEngine`, `defaultRuleSet` (כפילות מול vault/defaults), `OP_IDS` re-export.
- **multiSign/batchSign/crossChainSign** — ממומש, לא מחובר.
- אזהרת-הזנחה קטנה: מדדי getJson בדפים מסוימים עדיין ללא TTL-cache משותף (2 pollers ל-orderbook).

## 4. ה-DEX — בחינה ומה הלאה

**מצב אחרי R2:** **מחזור החיים סגור ומוכח-אורקל.** limit_order_create (M1) → פקודות פתוחות חיות ב-UI (טבלה על ה-poller הקיים של ה-wallet) → **limit_order_cancel (R2)**: סריאליזציה זהה-בית-לבית מול הסריאליזר של הצומת עצמו (ראו למטה), בנייה דטרמיניסטית, חתימה+שידור דרך `/api/vault/sign-cancel` (מדיניות + audit, allowlist כבר כלל את ה-op), כפתור Cancel לכל שורה עם דיאלוג step-up מלא. ספר/טייפ/ticker/יתרות חיים מ-api.steemit.com. אפס mock.

**אורקל חי (גילוי R2, שימושי לכל הרשת):** `condenser_api.get_transaction_hex` מקבל טרנזקציה ללא חתימות (vector ריק) ומחזיר hex קנוני — כלומר **לכל op עתידי אפשר להוכיח פורמט-חוט מול הצומת עצמו, בלי מפתחות**. הווקטור של cancel: `0100020000004069a06a 01 06 0a 68656164636f726e6572 4d000000 00 00`. כלי-הוכחה נדרש: `bun tools/cancel-oracle-test.ts` (ALL PASS 4/4).

**תחבורה (R2):** רשימת failover חיה (api.steemit.com → api.justyy.com → api.steemitdev.com — שלושתן נמדדו חי; **api.steem.fan שהוצע קודם נמדד מת ונפסל**), sticky last-known-good, TTL-cache 2.5s משותף לכל ה-pollers, ותצוגת chain-lag חיה ליד הטייפ.

**מגבלות שנותרו (כנות):** הרגל הסופית — שידור cancel אמיתי על פקודה אמיתית — דורש סיסמת-כספת (בעלים בלבד; כל הנתיבים עד השער הוכחו). רייט-לימיטר per-IP הוכח חי (30/דקה בדיוק, אחר כך 429).

## 5. המיקרו-גריד (grid98) — בחינה ומה הלאה

**מצב אחרי R2:** הבנץ' **רץ-חוזר מה-UI** (PROOFS: RE-RUN BENCH — תוצאה קודמת לצד חדשה, הגנה מריצות-מקבילות על grid98-state.json). נמדד שוב חי: 189,518 tx/s (מול 183,998 ב-ledger), 223,872 tx/s ב-curl. המנוע האמיתי, מ-ledger אמיתי.

**אינווריאנט supply==locked חי ב-`/api/system/health` (R2):** וידוא nano-exact לכל נכס עטוף — והוא **תפס אי-התאמה אמיתית**: ENERGY 49.5 מוטבע מול 50 נעולים (Δ −0.5) → critical. זו ממצא-נתונים אמיתי מה-daemon, לא באג בבדיקה. **החלטת בעלים:** אם יחס 0.99 מכוון לנגזרת-ה-SP — לפטור אותו מפורשות באינווריאנט; עד אז הוא מדווח critical כי הנתונים אומרים supply ≠ locked.

**נותר:** התאמת-ledger חוצת-תיקיות (האם ה-daemon מקבל תוצאות bench מקומיות — דורש תיאום עם סוכן ה-daemon).

## 6. צעדים קריטיים הבאים — מדורג (עדכון אחרי R2)

**הושלם ב-R2 (היה ברשימה הקודמת):**
1. ~~Live-burn ל-429~~ — **בוצע חי**: 1,031 קריאות SDK אמיתיות, 30×429, `retryAt == X-RateLimit-Reset == חצות UTC הבא`, fail-closed מוכח, מצא off-by-one כנה (check-then-act מאפשר בדיוק קריאה-אחת נוספת ב-25 מקביליות — תועד, החלטת-בעלים ל-reservation טרנזקציוני). `docs/m1-429-liveburn.md`.
2. ~~limit_order_cancel end-to-end~~ — **בוצע + אורקל-חי** (סעיף 4).
3. ~~Multi-hop ב-router~~ — **בוצע**: reverse-legs; `steem→tron` חי 2-רגלי; `hive→ethereum` מורכב עם סיבות-gate כנות לכל רגל; direct rails זהים-בתים (30/30 ב-`tools/router-multihop-test.ts`).
4. ~~כיבוי `ignoreBuildErrors`~~ — **בוצע** (0 שגיאות; המסכה כבויה).
5. ~~Re-run bench ב-PROOFS~~ — **בוצע** (סעיף 5).
6. ~~Anchor-health alert ב-SAOS HUB~~ — **בוצע** (סף = max(3×cadence נמדד, 600s); כרגע חי: ANCHOR OK).
7. ~~אינווריאנט supply==locked ב-health~~ — **בוצע** ותפס ממצא אמיתי (ENERGY — סעיף 5).
8. ~~Rate-limit per-IP על trade/build~~ — **בוצע** (build + cancel, 30/min, הוכח חי).
9. ~~TTL-cache + failover~~ — **בוצע** (סעיף 4); ~~lagSeconds~~ — **בוצע**.

**אפשרי-עכשיו בתוך הסנדבוקס (קוד בלבד):**
1. **חיבור ה-ZK** — commitment ב-init + וריפיקציה ב-unlock (או הסרה מה-barrel) — הפריט הפתוח היחיד ששרד מהסבבים הקודמים.
2. **Auth ל-developer console** (הפער המוצהר של W1) + rate-limit ל-unlock.
3. **Reservation טרנזקציוני למכסה** — סוגר את ה-off-by-one שנמדד ב-burn (החלטת-בעלים: האם קריאה-אחת מעל 1,000 במקביליות גבוהה מקובלת).
4. **הכרעת ENERGY** — פטור מפורש באינווריאנט או תיקון ב-daemon (חוצה-תיקיות).
5. ולידציית account מאוחדת ב-UI (regex ה-UI מקבל שמות שהרשת דוחה — השרת כבר fail-closed).

**פעולות-בעלים (לא ניתן מבפנים):** npm publish (credentials) · שליחת outreach (SMTP) · דומיין/BASE_URL ציבורי · דיפלוי חוזה/פרוגרם גשר (כסף אמיתי) · אתחול-כספת + סיסמה (שוער אחרון של cancel-broadcast חי) · החלטות daemon/פליט-מפתחות ב-repos האחרים.

**מדד ההצלחה של Model 1 (לא שונה):** 3 אינטגרציות ≥100 verifications/day.

## 7. מה סוכנים אחרים יכולים לקחת מהתיקייה הזאת

| נכס | איפה | שימוש חוזר |
|---|---|---|
| מנוע אימות זהות | `src/lib/anchor-verify.ts` | EIP-191 + base58check + EIP-55 מוכחים — רלוונטי לכל שירות שמאמת חתימות Graphene/EVM |
| API keys + מכסות | `src/lib/api-keys.ts` + `prisma/schema.prisma` | תבנית SHA-256-only + UTC quota + headers — תקן לכל API מדוד |
| SDK רשמי | `packages/saos-id-verify` | הלקוח המוכח ל-verify API (כולל טיפול 429/401) |
| כספת M2 | `packages/core` | vault/policy/audit/backup שלמים עם seams ל-Prisma (`src/lib/vault-stores.ts`) |
| סריאליזציה Steem | `packages/chains/steem` | bit-exact מול הצומת — כלי serialize-test מריץ 30/30 |
| סטטוס-פליט | `src/lib/fleet-status.ts` | SP/VP/RC formulas + last-ops probing — שימושי לכל מי שמנטר את 13 החיילים |
| הידרציית מעבדה | `tools/grid98-hydrate.ts` | דפוס להבאת ארטיפקטים מה-org עם טוקן (לא ל-commit את הטוקן!) |
| דפוסי-כנות | כל הרואטים | fail-closed + null במקום המצאה + `source` לכל נתון |

## 8. פקודות בדיקה-עצמית (ריצה חוזרת לכל סוכן)

```bash
curl -s http://localhost:3000/api/system/health | python3 -m json.tool | head -40   # 7/7 + wrappedInvariant (ENERGY ממצא ידוע)
curl -s "http://localhost:3000/api/saos/anchor-verify?username=headcorner" | python3 -m json.tool   # sameScalarProof:true
curl -s "http://localhost:3000/api/saos/grid98-bench?benchMs=10000" | python3 -m json.tool          # ok:true + txsPerSec חי
bun tools/grid98-hydrate.ts          # אם המעבדה חסרה (idempotent)
bun tools/serialize-test.ts --rpc https://api.steemit.com --samples 10   # 30/30
bun tools/m1-op-test.ts              # 27/27
bun tools/cancel-oracle-test.ts      # 4/4 — limit_order_cancel == node serializer (R2)
bun tools/router-multihop-test.ts    # 30/30 — multi-hop reverse-legs (R2)
curl -s -X POST http://localhost:3000/api/steem/trade/cancel -H "Content-Type: application/json" -d '{"account":"headcorner","orderid":77}'   # preview חי
bunx tsc --noEmit                    # 0 שגיאות מחוץ ל-examples/skills (המסכה כבויה ב-next.config)
```

---
*עמדת-יושר: כל מספר כאן נמדד חי ב-2026-09-08 בתיקייה הזאת. מה שלא נמדד — כתוב null/פתוח. המספרים הפיננסיים ב-docs האחרים כולם speculative ומסומנים.*
