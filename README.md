# Saosmartwallet — ארנק פורץ-דרך לרשת ממשפחת Steem

**ROLE (declared 2026-10-11, task 10-c un-silence sweep — complements
REVIVAL-2026-10-11.md):** the **wallet product design & bridge-adapter
source** — wire formats verified against real chain bytes, 3 chain adapters
(steem/ethereum/solana) in `packages/chains`. Known anti-pattern recorded by
the audits (git-committed `db/custom.db` = live key vault, 248 AES-GCM
entries) — its fate is an OWNER decision (rotation/scrub), not a code lane
(E-series records the same). Why it was muted: design-complete, runtime
never deployed. **UNBLOCKED (2026-10-26, wave 20.1 / G77-d — owner MASTER
DIRECTIVE §3.1): the signing component is a prototype no longer —
`packages/hsm-runtime` is the PRODUCTION HSM SIGNING RUNTIME, deployed on
sovereign-runner-kit :3155 (`saos-hsm-runtime.service`, `Restart=always`):
SIGN-ONLY with the no-broadcast law structural (no route exists),
deny-by-default token gate, key material ONLY inside the packages/vault
AES-256-GCM store (path-only custody, 0600), signed-transaction receipts
with wire digests, honest per-capability verdicts
(READY/NO-KEYS/SEALED/BLOCKED — never fake-ready). Boot proof (measured
matrix): sovereign-runner-kit `receipts/hsm-runtime/boot-proof.json`;
suite 46/46 green. Soldier-key loading stays owner-custody — the runtime
reports NO-KEYS honestly until the owner loads keys. The web product
runtime (Next app) remains owner-scope work.** Revival path: (1) owner
decision on the committed vault DB,
(2) drop the 61MB skills/ scaffold, (3) dispatch wallet-verify — everything
else is ready.

> **סטטוס: M0+M1+M2+M3+M4 מומשו ואומתו מול ה-chain · 7 רשתות חיות (STEEM/HIVE/BLURT/TRON/SAOS-NET/ETHEREUM/SOLANA) · Sovereign Key Vault חי · שכבת גשרים עם router+quotes חיים · M4 System Owner: בדיקות-חיים מאוחדות (/api/system/health) + דו"ח סטטוס חי (docs/system-status) + failover הוכח חי**
> עדכון אחרון: 2026-09-08 (Asia/Jerusalem)

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
| [`packages/core/`](./packages/core/README.md) | Sovereign Key Vault — Argon2id + AES-GCM/ChaCha20 + Shamir + ZK · Policy Engine · Signing Orchestrator · Backup · Audit hash-chain | ✅ M2 |
| [`packages/hsm-runtime/`](./packages/hsm-runtime/README.md) | **Production HSM signing runtime (wave 20.1 / G77-d):** token-gated SIGN-ONLY API (:3155) over the vault — steem-family + ed25519 signing, receipts with wire digests, deny-by-default, honest READY/NO-KEYS/SEALED verdicts, no broadcast route | ✅ **פרוס ב-sovereign-runner-kit** (:3155, boot-proof receipts) |
| [`packages/chains/ethereum/`](./packages/chains/ethereum/) | EthereumAdapter (EIP-1559) — build/sign + ERC-20 + EIP-55 נגזרת ממפתח ה-vault · broadcast נעול | ✅ M3 |
| [`packages/chains/solana/`](./packages/chains/solana/) | SolanaAdapter (Ed25519) — build/sign + SPL read · broadcast נעול | ✅ M3 |
| [`packages/bridges/`](./packages/bridges/) | שכבת גשרים: router (מציאת-נתיב + quotes עמלות חיות) · monitor (סטטוס-מסילות מה-state החי) | ✅ M3 |
| [`packages/saos-id-verify/`](./packages/saos-id-verify/README.md) | **ה-SDK הרשמי של Model 1 (שבוע 2):** לקוח TypeScript אפס-תלויות ל-`POST /api/v1/identity/verify` — union מטופס PROVEN/FAILED, מחלקות 401/429 fail-closed, parsing של X-RateLimit; build strict tsc → dist/ publish-ready | ✅ דוגפוד חי (PROVEN+FAILED+401 דרך ה-SDK וגם דרך dist) |
| `tools/serialize-test.ts` | סוויטת אימות מול chain חי | ✅ **30/30 PASS** |
| `tools/m1-op-test.ts` | סוויטת limit_order_create מול oracle | ✅ **27/27 PASS** |
| `tools/m1-w2-sdk-dogfood.ts` | דוגפוד חי של SDK `saos-id-verify` מול ה-API הממוסחר (PROVEN/FAILED/401 דרך ה-SDK) | ✅ **3/3 PATHS** |
| `tools/m3-adapter-check.ts` | סוויטת ETH/SOL מול mainnet חי (health/info/ERC20/SPL/build/sign/fail-closed) | ✅ **23/23 PASS** |

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

**שער M2 נפתח:** החתימה עוברת דרך ה-Sovereign Key Vault — מפתחות חתומים (Argon2id + AES-256-GCM), כל חתימה עוברת Policy Engine (fail-closed) ונרשמת בשרשרת audit בלתי-הפיכה; broadcast רק בהתערבות מפורשת של המשתמש.

```bash
bun run dev   # הטרמינל חי על / — נתונים חיים מ-api.steemit.com
```

## 🌐 SAOS — Sovereign Identity Network · Command Surface (2026-09-08 UI overhaul)

**ה-UI התהפך SAOS-first (roast → מהפכה):** עד היום המסך הראשון נפתח כטרמינל-שוק של STEEM/SBD (המחיר הגדול ב-header, STEEM כרטיס #1) — ההיפוך: **SAOS היא המותג והרשת שלנו**, STEEM/SBD הוא רק רכבת-עוגן חיצונית. Header חדש: wordmark SAOS + "SOVEREIGN IDENTITY NETWORK", בלי טיקר STEEM/SBD בכלל; מסך-פתיחה חדש `SAOS` עם hero (משפט-זהות + ויטלים ריבוניים חיים + **checkpoint anchors אמיתיים עם txids ציבוריים** מ-`/api/eco/anchors`) · 10 טאבים → **9 טאבים** (SAOS · SAOS HUB · PROOFS · SAOS-NET · MARKETS · BRIDGES · WALLET · VAULT · DEVELOPER) — REGISTRY מוזג לתוך DEVELOPER, DEX הפך MARKETS (עם pairs matrix), וכל 9 הטאבים נגישים במקלדת 1–9.

| טאב | תוכן | מקור נתונים (חי) |
|---|---|---|
| **SAOS** (פתיחה) | **Hero ריבוני**: משפט-זהות + CTAs (RUN A LIVE IDENTITY PROOF → PROOFS · GET A METERED API KEY → DEVELOPER) · SAOS-NET height (sparkline) · 64 checkpoints · 1,831 txs verified · kernel bench · treasury · wrapped 20 (supply==locked) · pools 14 · rails 7/7 · **strip של checkpoint anchors עם txids קליקים ל-explorer** · Network Grid עם **SAOS-NET תמיד ראשון** (chip ״OUR CHAIN״) | `/api/eco/saosnet` · `/api/eco/anchors` · `/api/eco/networks` |
| **SAOS HUB** | **SAOS במרכז הבמה**: Chain Core · grid98 (bench נמדד · סולם-רצפה · שערי-כנות) · **צי-החיילים אינטראקטיבי** (SP/VP/RC חי) · מפקד-לולאות · 14 בריכות · 20 wrapped · 15 ציטוטי-oracle חתומים · anchor rails · dex-facts כנים | `/api/eco/saos-hub` |
| **PROOFS** | 3 demos חיים: Identity Anchor (EIP-191 + ecrecover — sameScalarProof חי) · Grid98 Live Benchmark · Soldier Fleet 13/13 | `/api/saos/*` |
| **SAOS-NET** | המנוע הריבוני: bench נמדד, treasury P&L, הספר-הריבוני (depth chart), oracle חתום, wrapped, delegations | `state.json` (daemon-push) |
| **MARKETS** | (לשעבר DEX — המקום הנכון למסחר) MarketStrip (STEEM/SBD + spread + SAOS/STEEM ספר-ריבוני + floor) · Pairs Matrix (18 markets) · Order Book + Terminal + Tape | api.steemit.com + `state.json` |
| **BRIDGES** | M3 Bridge Explorer + מטריצת עוגנים + Live Anchor Feed + TRON Pulse | router + checkpoints |
| **WALLET** | יתרות/SP/RC/פקודות + M3 ETH/SOL lookups + סטטוס הכספת | api.steemit.com + adapters |
| **VAULT** | Sovereign Key Vault: wizard · Policy Engine · Backup/Shamir · Audit chain | packages/core (M2+M3) |
| **DEVELOPER** | Model 1 המדוד: API keys · try-it · usage ledger · SDK `saos-id-verify` · **+ REGISTRY המוזגת לכאן** (8 ריפו · שירותים · פערים כנים) | `/api/developer/*` · SQLite (Prisma) |

**מקורות חיים:** `api.steemit.com` · `api.hive.blog` (+fallbacks) · `rpc.blurt.world`/`saboin` (+fallbacks) · `api.trongrid.io` · `ethereum-rpc.publicnode.com` (+fallbacks) · `api.mainnet-beta.solana.com` (+fallbacks) · daemon-state של SAOS-NET. כל ה-probes עם TTL cache בצד-השרת — כבוד ל-rate-limits.

**קיצורי מקלדת:** מקשים **1–9** מחליפים **את כל 9 הטאבים** (כולל DEVELOPER — אין יותר טאב ״רק-לחיצה״).

## 🌉 M3 — Multi-Chain Sovereign Ecosystem (2026-09-08)

**7 רשתות, מנוע-אחד.** האדפטרים החדשים מממשים את ה-seam הקפוא (`packages/chains/chain-adapter.ts`) מבלי לשנות אותו:

| רשת | סוג | חתימה | read מורחב | broadcast |
|---|---|---|---|---|
| ETHEREUM (eip155:1) | EVM · EIP-1559 | secp256k1 — **אותו מפתח vault**, כתובת EIP-55 (keccak) | `getChainInfo` (עמלות חיות) · ERC-20 balance · receipt | 🔒 fail-closed |
| SOLANA (solana:mainnet-beta) | PoH+PoS | Ed25519 — **אותם 32 בייטים כ-seed** (סכימת-מפתח מאוחדת) | `getChainInfo` (epoch) · SPL token accounts · signature status | 🔒 fail-closed |

**סכימת-המפתח המאוחדת (M3):** ה-WIF של ה-vault הוא 32 בייטים של secp256k1 — אותם בייטים משמשים כמו שהם ב-Ethereum (אותה עקומה, קידוד-כתובת שונה) וכ-**seed** של Ed25519 ב-Solana. סוד-אחד, פרשנות-פר-שרשרת; אפס שיתוף-חתימות בין-שרשראות.

**שכבת-הגשרים (`packages/bridges`):**
- **Router** — מציאת-נתיב על קטלוג-מסילות כן (2 חיות: SAOS-NET→Steem/TRON · 4 gated: Hive RC / Blurt nodes / ETH+SOL ממתינים לחוזה-פרוס). כל רגל-עמלה נושאת שדה `source` — מאיפה המספר הגיע (עמלות ETH חיות מהצומת · קבועות-פרוטוקול של Solana · "0 TRX נמדד"). אין-נתיב = מערך ריק, לעולם לא נתיב מומצא.
- **Monitor** — סטטוס-מסילות + analytics מה-state החי (anchors, verified checkpoints, wrapped collateral 1:1). מה שלא נמדח = `null`, לעולם לא מומצא.
- **API** — `GET /api/bridge/routes?from&to&asset&amount` · `GET /api/bridge/status` · `GET /api/eco/account?network=ethereum\|solana&address=`.

**אימות חי (23/23, `bun tools/m3-adapter-check.ts`):** health+height מול mainnet · יתרות מדויקות-BigInt (BigInt-lamports לעולם לא float) · ERC-20 (USDT) · SPL (4,287 חשבונות) · build+sign EIP-1559/legacy עם אימות-ed25519 מהצומת · גזירת-כתובות EIP-55/Base58 · broadcast fail-closed · מדיניות-תפקידים fail-closed.

**כנות (ראו REGISTRY):** אין חוזה-גשר פרוס ב-Ethereum ואין תוכנית ב-Solana — מסילות ה-mint מדווחות `gated` עם הסיבה; ה-lock-op מוגדר ומוכן. שידור ב-ETH/SOL נשאר נעול (M0 gate) עד להחלטה מפורשת.

## 🛡️ M4 — System Owner Mode (2026-09-08)

אחריות מלאה על האקוסיסטם: אימות-חיים של כל רכיב, ריפוי-עצמי מוכח, סריקת-פערים מחודשת, ודיווח מקיף.

**בדיקות-החיים המאוחדות — `GET /api/system/health`:** מדד-אחד שחוקר בכל קריאה את 7 הרשתות (גבהים חיים), 6 מסילות-הגשר (עדות חיה), 2 quotes-ראוטר ישירים (STEEM→ETH/SOL עם עמלות חיות ו-gateReason), את הכספת (ללא-סודות) ואת ה-DEX (ticker+orderbook+spread). כל רכיב-מת מדווח כ-DATA (issue עם סיבה+פעולה), לעולם לא V ירוק מאויר ולא 500.

**ריפוי-עצמי — הוכח חי:** אדפטר Ethereum שנבנה עם RPC מת בראש ספר-נקודות-הקצה התאושש מיד לצומת החיה (lag 4s). ירידה רגעית של STEEM ב-strip (6/7) חזרה ל-7/7 תוך שניות — דיווח-כנה של תקלה חולפת, לא תקלה.

**תיקון-באג אמיתי (M4):** ולידטור שמות-החשבונות ב-Steem אכף `segment > 13` — כלל שאינו קיים ב-steemd. אומת מול mainnet (`steem-venezuela`, סגמנט 15 תווים, חי מ-2020-08-08) ותוקן לכלל האמיתי: סה"כ 3..16 · סגמנט ≥3 · אות בהתחלה · [a-z0-9-] באמצע · [a-z0-9] בסוף. לפני התיקון, משתמשי-DEX עם שמות ארוכים היו נחסמים מהחתימה.

**סריקת-פערים מחודשת (`tools/repo-scan.ts` → `docs/repo-scan.json`):** 8 ריפו נסרקו חי (עצים+READMEs+manifests). המסקנה עדכנית: אין קוד ETH/SOL בשום ריפו **מלבד שלנו** (M3). `saos-sovereign-foundry` משלים אותנו בפילוסופיה keyless (dry-run probe + external-signer + אימות-txid ציבורי) — נקודת-אינטגרציה עתידית, לא קוד-להעתקה. מפת-פערים כנה: חוזה-גשר פרוס ✗ · תוכנית Solana פרוסה ✗ · MEV ✗ · gas-oracle ✓ (EIP-1559 חי) · failover ✓ (הוכח) · multi-sig אפליקטיבי ✓ (3-of-5 + social recovery).

**דוח-סטטוס חי:** `docs/system-status.json` + `docs/system-status.md` — נוצר ע"י `bun tools/system-status.ts` מול `/api/system/health` החי; כל מספר נמדד בזמן-יצירה, מה שלא נמדח = null עם הסיבה.

**מפת-דרכים אסטרטגית (`docs/strategy-roadmap.md`):** ניתוח-עסקי מעוגן-חיים — 7 מודלים עסקיים (Wallet-as-a-Service · Bridge Aggregator · DEX Aggregator · Validator · White-Label · Security Audits · Institutional Custody) ממופים ליכולות-מאומתות מול שערי-חוסמים כנים; המלצה: bootstrap + open-core, סדר-בנייה מדורג (M5 Wallet MVP אוטונומי → פריסת חוזה-גשר/audit/פיילוט = החלטות-בעלים). zero-mock גם באסטרטגיה: הטענות-טכניות בניתוח אומתו מחדש באותו-יום (7/7 · 23/23 · 2 גשרים חיים), הטענות-פיננסיות סומנו כספקולטיביות.

## 🔒 SOVEREIGN MODE — הסבב השלישי: כל הפריטים הפתוחים נסגרו חי (2026-09-08)

חמשת ה"אפשרי-עכשיו" מ-network-summary §6 בוצעו, כל אחד עם הוכחה חיה:

1. **מכסה אטומית** — `QuotaCounter`: upsert מותנה אחד (`WHERE used<limit` + `RETURNING`) — סוגר את ה-off-by-one שנמדד ב-burn. `tools/quota-race-test.ts`: 1,050 מקביליות → בדיוק 1,000/50, overshoot **0**, `ATOMIC-PROVEN` 7/7.
2. **ZK מחובר לכספת** — `zkCommitment` (Schnorr Fiat–Shamir על secp256k1) ב-init, נבדק ב-unlock + שתי step-ups; מאמת עצמאי שני ל-Argon2id (שחיתות בכל verifier אחד → fail-closed). `tools/vault-zk-check.ts` 9/9 `ZK-WIRED-PROVEN`.
3. **Auth ל-console** — bootstrap copy-once (`POST /api/developer/admin/bootstrap`) + `requireAdmin` על יצירה/שלילת מפתחות; `SAOS_ADMIN_TOKEN` מנגלה; unlock 10/min + init 5/min (הוכח חי: 10×409→429).
4. **הכרעת ENERGY (מבוססת-ראיות)** — ה-daemon עצמו מטריח cover ≥101% (`bridgeMintTxs` → supply=0.99·locked); האינווריאנט תוקן ל-*over-issue* כקריטי: ENERGY 49.5/50 = ה-posture המתוכנן, cover 1.010101, criticalIssues 0.
5. **ולידציית account מאוחדת** — `src/lib/account-name.ts` (חוקי steemd המלאים) בשני הפאנלים במקום ה-regex הרופף.

**אירוע חי:** `AUTHORITY DRIFT` — account_update על headcorner (blk 109,410,651, 21:17 UTC) החליף את ה-active authority; ה-API מדווח FAILED כנה עם פירוט שני הכתובות — המוצר תופס סטיית-סמכות בזמן-אמת, בדיוק כמו שהובטח. ה-verifier שודרג לסווג זאת מפורשות.

## 🔱 SAOS Deep Dive — Breakthrough Proof (2026-09-08)

**SAOS במרכז הבמה.** סריקת-עומק חיה של כל הרכיבים הריבוניים (GitHub API על 6 ריפו + probes על mainnet + ה-state החי) וארבעה מסמכי-אמת:

| מסמך | תוכן |
|---|---|
| `docs/saos-inventory.md` | מיפוי מלא: chain kernel (`saosnet.cjs` 142KB) · grid98 · ה-13 חיילים (13/13 חיים על Steem mainnet, נמדדו SP/VP/RC) · מפקד-לולאות (8 agent + 15 node daemons) · 6 גשרים · 20 wrapped · 15 oracle · פערים כנים |
| `docs/saos-capabilities.md` | **16 יכולות מוכחות** — כל אחת עם proof חי + value + efficiency |
| `docs/saos-breakthroughs.md` | **5 פריצות-דרך**: עוגן-זהות חוצה-פרדיגמות (EIP-191 ⇄ Graphene, ecrecover-verifiable) · shadow-L1 עם אבטחה-שכורה (עוגנים ל-3 שרשראות ב~אפס-עלות) · grid98 honesty-engine (383,836 skipped-for-edge — הסירוב-הוא הפיצ'ר) · כלכלת-wrapped 1:1 עם הוכחות-מנט ציבוריות · המטא: מערכת שמתעדת את עצמה |
| `docs/saos-strategy.md` | SAOS-first: הרשת הריבונית = המוצר, 7 הרשתות = ההיקף; סדר-בנייה S1–S4 עם שערי-בעלים |
| `docs/agents-survey.md` | **סקר תיקיות-הסוכנים (2026-09-08):** מפת `engineering/`+`wallet-design/`+`tests/`+`tool-results/` · תיקון הדימום של 267 שינויי-mode (core.fileMode=false) · **החיבור הגדול**: ההצעה המייסדת F1–F5/R1–R3 מול מה שנבנה בפועל (R1/R2 ✅ · F4/F5/F1/F3 🟡 · F2 ❌ — עם ראיות-קוד) · 4 החלטות-בעלים שנאספו |
| `docs/model1-week3-outreach.md` | **ערכת outreach (2026-09-08):** 10 יעדים אמיתיים עם חשיפה למשתמשי Steem/Hive (כולם נבדקו חי) · וקטור-חשיפה מבוסס לכל אחד · 5 טיוטות-דוא״ל · נספח-הוכחה ציבורי (עוגן על-שרשרת + EIP-191 עצמאי + curl) · metric הצלחה; השליחה = פעולת-בעלים |
| `docs/network-summary.md` | **סיכום-רשת מקיף (NET-AUDIT, 2026-09-08):** מה התיקייה תורמת לרשת · הישגים נמדדים-חי · ביקורת מלאה (14 באגים תוקנים, 26 טייפ-שגיאות→0, `.grid98-lab` חזר והבנץ' חי: 232,283 tx/s) · בחינת DEX + מיקרו-גריד עם צעדים הבאים · טבלת נכסים לשימוש-חוזר בין סוכנים · פקודות בדיקה-עצמית |
| `docs/security.md` | **מודל-איום + מדיניות-אבטחה (SEC-HARD, 2026-09-08):** שרשרת-אספקה (lockfile נעול · 0 lifecycle-scripts · npm-audit חי: 0 פגיעויות · SDK אפס-תלות) · סריקת-secrets (0 WIF/PEM/env ב-git) · allowlist לדפוסים-מסוכנים (eval/child_process/innerHTML) · headers חיים (CSP/nosniff/referrer/permissions, X-Powered-By כבוי) · מפת rate-limits מלאה (כולל grid98-bench 3/min ו-anchor-verify 10/min — 429 הוכח חי) · **`bun tools/security-audit.ts` = השער המכני — 23/23 PASS, exit 1 = אסור לדחוף** |

**תיקון-כנות:** מספרי-bench ישנים ("130K", "32.6K", "146,956") היו נכונים לרגע-המדידה בלבד — ה-bench **חי ומדיד-חוזר** (עכשיו גם מקומית אחרי `tools/grid98-hydrate.ts`): הרצה אחרונה **232,283 tx/s** (2,322,825 txs אמיתיים / 10s). תמיד להריץ `curl /api/saos/grid98-bench` — לא לצטט מהזיכרון.

**UI חדש — טאב SAOS HUB (מקש 2):** `/api/eco/saos-hub` מאגד בחיים: Chain Core · grid98 (שערי-כנות + סולם-רצפה) · **צי-החיילים האינטראקטיבי** (לחיצה = מה-הוא-עושה-עכשיו: SP/VP/RC חי, fleet-seq, arena-PnL, scopes) · Loop Census עם הוכחת-bytes מ-GitHub · 14 בריכות · 20 wrapped · 15 oracle חתומים · anchor rails (txids ציבוריים) · dex-facts כנים. אפס-mock: מה שלא נמדד = null עם הסיבה.

**תשתית סריקה חדשה:** `tools/saos-deep-scan.ts` (→ `docs/saos-scan.json` · 6 ריפו, מיפוי-מילות-מפתח לכל-רכיב-ריבוני) + `tools/saos-fetch-core.ts`/`round2` (שליפת-קוד-מקור לתחקיר).

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
