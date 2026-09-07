# Wallet Architecture — ארכיטקטורה מלאה

| שדה | ערך |
|---|---|
| תאריך | 2026-09-07 (Asia/Jerusalem) |
| סטטוס | ⚠️ מותנה בהנחת רשת ממשפחת Steem — ראו [`network-analysis.md`](./network-analysis.md) |
| תכונות Core | [`breakthrough-ideas.md`](./breakthrough-ideas.md) (5 Core + 3 Rails) |
| המשך | [`final-proposal.md`](./final-proposal.md) (היקף MVP, מילסטונים, סיכונים) |

---

## 1. עקרונות מנחים (Design Principles)

1. **Network-agnostic core + chain adapter** — הליבה (דומיין, מדיניות, UI) אינה יודעת את הרשת; הרשת נסגרת בשכבת adapter אחת. ההשקעה נשמרת גם אם הנחת הרשת תתבדק (החלטה שנקבעה ב-`network-analysis.md` §3).
2. **מפתחות לעולם לא יוצאים מהלקוח** — אין שרת חתימה, אין key escrow, אין custody. השרת (indexer) הוא **קריאה-בלבד**.
3. **Least-privilege signing** — כל פעולה נחתמת במפתח הפחות-מורשה שמספיק (Aurora Modes).
4. **Fail closed** — תגובת RPC חריגה/לא-תקפה = עצירה, לא "עובד בדרך כלל".
5. **סט פעולות סגור** — לרשת אין EVM; כל פעולה ידועה מראש וניתנת לאכיפת מדיניות דטרמיניסטית לפני חתימה.
6. **לא עושים**: גשרים (bridges), ייצוג נכסים חוץ-רשתיים, הבטחות תשואה, מסחר מונחה-בוט.

## 2. דיאגרמת ארכיטקטורה (High-Level)

```
┌─────────────────────────────────── CLIENTS ───────────────────────────────────┐
│                                                                               │
│   apps/web-wallet (Next.js PWA)          apps/mobile (RN)    apps/extension   │
│   ┌─────────────────────────────┐         (Phase 3)          (Phase 3)        │
│   │  UI (ui-kit)  │ Zustand │TanStack Query│  ← state                        │
│   └───────────────┴──────────┴──────────────┘                                 │
└──────────────┬────────────────────────────────────────────────────────────────┘
               │ חבילות משותפות (packages/*) — אותו קוד בכל הלקוחות
┌──────────────▼────────────────────────────────────────────────────────────────┐
│  packages/core-domain   operations model · policy engine · portfolio math      │
│  packages/chain-adapter ChainAdapter interface + steem-family implementation   │
│  packages/keystore      KDF · key slots (posting/active/owner) · zeroization   │
│  packages/sdk           sign-request schema ל-dApps (Phase 3)                  │
└──────────────┬────────────────────────────────────────────────────────────────┘
               │ (1) קריאה: JSON-RPC/REST ל-indexer
               │ (2) חתימה: מקומית, בלקוח (לעולם לא עוברת ברשת)
               │ (3) שידור: broadcast של עסקה חתומה ישירות לצומת
┌──────────────▼────────────────────────────────────────────────────────────────┐
│  services/indexer (קריאה-בלבד)                                                │
│  cache יתרות/היסטוריה · חישוב RC · מחירים · WS fan-out להתראות · rate-limit   │
│  ── לעולם לא מחזיק מפתחות, לא מקבל חתימות, לא כותב לרשת ──                    │
└──────────────┬────────────────────────────────────────────────────────────────┘
               │ JSON-RPC / WebSocket
┌──────────────▼────────────────────────────────────────────────────────────────┐
│  Chain node(s): steemd / hived (public endpoints או self-hosted בהמשך)        │
│  multi-node quorum לקריאות קריטיות (יתרות, authorities)                       │
└───────────────────────────────────────────────────────────────────────────────┘
```

**זרימת חתימה (הנתיב הקריטי):**

```
משתמש מבקש פעולה (למשל transfer)
   │
   ▼
core-domain: בניית OperationDraft (סוג + פרמטרים, ולידציה zod)
   │
   ▼
Policy Engine: האם מותר? (תקרה/רשימה לבנה/velocity) ──חסום──▶ נחסם + נרשם
   │ עובר
   ▼
Aurora Modes: בחירת key slot הפחות-מורשה שמספיק (posting? active? — owner לעולם לא חם)
   │
   ▼
keystore: פתיחת slot (bio/סיסמה, per-op ל-active) → חתימה מקומית
   │
   ▼
chain-adapter: broadcast לצומת → TxResult → audit log מקומי (רשימת-קריאה)
```

## 3. מבנה מונורפו (Monorepo)

```
saosmart-wallet/
├── apps/
│   ├── web-wallet/            # Next.js 16 (App Router) + PWA — הארנק הראשי
│   │   ├── app/               # routes: treasury / modes / onboarding / settings
│   │   └── ...
│   ├── extension/             # browser extension (Phase 3 — חולקת packages)
│   └── mobile/                # React Native (Phase 3)
├── packages/
│   ├── core-domain/           # TS טהור: operations, policy engine, portfolio math, zod schemas
│   ├── chain-adapter/         # ChainAdapter interface + steem-family impl (מבוסס dhive)
│   ├── keystore/              # KDF, key slots, storage backends (WebCrypto/keychain), test vectors
│   ├── ui-kit/                # design system (Tailwind + shadcn/ui baseline)
│   └── sdk/                   # סכימת sign-request ל-dApps (Phase 3)
├── services/
│   └── indexer/               # Node/TS קריאה-בלבד: REST + WS, cache (SQLite→Postgres)
├── tools/
│   ├── ci/                    # pipelines, SCA config
│   └── vectors/               # test vectors: KDF, חתימה, פוליסיות
└── docs/
    ├── adr/                   # Architecture Decision Records
    ├── threat-model.md
    └── (מסמכי wallet-design מועתקים/מקושרים)
```

**כלי עבודה:** pnpm workspaces + Turborepo · TypeScript strict · ESLint+Prettier · changesets לגרסאות · GitHub Actions (typecheck→lint→test→SCA→build).

**חוקי תלות:** `core-domain` לא תלוי בשום דבר רשתי/React. `chain-adapter` תלוי רק ב-core. Apps תלויים ב-packages — לא בין apps. מייבאים מ-`@saos/*` בלבד.

## 4. ממשק ChainAdapter (סקיצה קונטרקטואלית)

```ts
// packages/chain-adapter/src/types.ts — קונטרקט, לא מימוש
export interface ChainAdapter {
  readonly chainId: string;
  getAccountSnapshot(name: string): Promise<AccountSnapshot>;   // יתרות, RC, authorities
  buildOp(draft: OperationDraft): Promise<UnsignedTx>;          // ולידציה מול סכימת הרשת
  sign(tx: UnsignedTx, slot: KeySlotHandle): Promise<SignedTx>; // בלב לקוח
  broadcast(tx: SignedTx): Promise<TxResult>;
  stream(filter: EventFilter): AsyncIterable<ChainEvent>;       // WS: transfers, RC, authorities
}
// KeySlotHandle = ידית אטומה מ-keystore; המפתח הגולמי לעולם לא נחשף ל-adapter
```

כל פעולה ב-MVP ממופה ל-op מוגדר של הרשת: `transfer`, `transfer_to_vesting`/הפוך, `delegate_vesting_shares`, `witness_vote`, `proposal_vote`, `custom_json` (התראות/פרופיל). אין דינמיות של "קריאת חוזה".

## 5. ארכיטקטורת אבטחה (הלב של המסמך)

### 5.1 מחזור חיי מפתחות

| שלב | מדיניות |
|---|---|
| **יצירה** | סיסמת-אב → גזירת מפתחות צד-לקוח לפי מפרט הרשת (KDF נייטיב; fallback: scrypt N=2^17, r=8) — יאומת מול קוד המקור של הרשת לפני קוד ראשון (שער M0) |
| **אחסון** | אין מפתחות ב-localStorage בטקסט חופשי. WebCrypto non-extractable keys ככל האפשר; במובייל — OS keychain; memory zeroization בנעילה |
| **הרשאות slots** | posting=חם (session) · active=per-op unlock (bio/סיסמה) · owner=**ייבוא חסום כברירת מחדל במכשיר מקוון**; ceremony מודרך בלבד (air-gapped/paper) |
| **שימוש** | רק דרך Policy Engine → Aurora Modes → adapter (מפתח אטום) |
| **גיבוי** | דף גיבוי מודפס (QR + טקסט), נוצר פעם אחת, עם אזהרות פישינג מובנות |
| **השמדה** | מחיקת slots + ביטול sessions + הנחיה לשינוי authorities ברשת |

### 5.2 Policy Engine (אכיפה לפני חתימה)

| כלל | ברירת מחדל |
|---|---|
| תקרת הוצאה יומית (active) | ניתנת להגדרה; מעבר = דרישת אישור דו-שלבי + המתנה מדורגת |
| רשימת יעדים מאושרים | יעד חדש = אישור מפורש; flag "חדש" ב-30 ימים הראשונים |
| Velocity | ≥3 עסקאות/דקה לאותו יעד = עצירה והצגת אזהרה |
| Authorities changed חיצונית | זיהוי ב-stream → נעילת מצב Treasury + הצעת זרימת Recovery |
| Audit log | רשימת-קריאה מקומית של כל בקשת חתימה (גם נחסמות), exportable |

### 5.3 קשיחות דפדפן/תעבורה

- CSP קפדני: אין inline scripts, אין סקריפטים צד-שלישי (אין analytics/CDN JS באפליקציית הארנק), SRI לכל נכס סטטי חיצוני.
- תגובות RPC: ולידציית סכימה (zod) על כל תגובה; קריאות קריטיות (יתרות/authorities) מאומתות מול **2 צמתים לפחות** (quorum).
- TLS בלבד; במובייל — certificate pinning ל-endpoints המוגדרים.
- Clipboard: הדבקת כתובת תמיד מוצגת לאישור עין-בעין; אזהרה על שינוי-לוח-גזירים.
- אין פרסונליזציה/טלמטריה ברירת-מחדל; אופט-אין מפורש בלבד.

### 5.4 Threat Model (מסוכם; מפורט ב-docs/threat-model.md בעתיד)

| איום | וקטור | מיגון |
|---|---|---|
| פישינג של סיסמת-אב | אתר מזויף | סיסמה נקלטת רק במסך vault מקורי; בדיקת origin; אין טפסי login חוץ-ארנק |
| XSS | הזרקת סקריפט | CSP קפדני, אין `dangerouslySetInnerHTML`, סקירת deps |
| RPC עוין/פגום | MITM/צומת רע | quorum רב-צומתי + ולידציית סכימה + fail closed |
| שרשרת אספקה | חבילת npm פגומה | lockfile נעול, מינימום תלויות, SCA ב-CI (osv-scanner), provenance |
| פשרת מכשיר | מלוואר | per-op unlock, תקרות הוצאה, posting-only ברירת מחדל — שטח נזק מוגבל |
| הנדסה חברתית "תמיכה" | מתחזות | אין תמיכה שמבקשת מפתחות; מסכי אזהרה; Recovery דורש owner multi-sig |
| גיבוי נגנב | דף גיבוי | הנחיה לכספת פיזית; owner דורש חתימת threshold — דף בודד אינו מספיק כשמוגדר multi-sig |

### 5.5 הצהרת אי-תחום (Non-Goals)

אין custody · אין גשרים · אין הבטחות תשואה · אין בוטי מסחר · אין איסוף מפתחות "לשירות". הארנק non-custodial לחלוטין — מה שחוסם גם בעיות רגולטוריות של נאמנות נכסים.

## 6. services/indexer (קריאה-בלבד)

- **REST**: `/account/:name/snapshot` · `/account/:name/history` · `/rc/:name` · `/prices` · `/governance/witnesses|proposals`
- **WS**: ערוצי התראות פר-חשבון (transfers, rc-low, authorities-changed, power-down)
- Cache SQLite (MVP) → Postgres (scale); טיפול ב-reorg (אימות עומק אישור לפי מפרט הרשת); rate-limit פר-IP; אימות עצמי מול 2 צמתים.
- הערה: זמינות public RPC לא אומתה בסביבה — שער M0 (ראו §8) כולל סקר endpoints חיים.

## 7. סטאק טכנולוגי (סיכום)

| שכבה | בחירה | סיבה |
|---|---|---|
| לקוח ראשי | Next.js 16 + TS + Tailwind + shadcn/ui | איתור מהיר, a11y, עקביות עם סקפולד קיים |
| State | Zustand (לקוח) + TanStack Query (שרת) | פרדת cache/state מקובלת ונבדקת |
| ליבה | TypeScript טהור ב-packages | נבדק/נבדק יחידה ללא DOM |
| רשת | dhive (משפחת Steem) תחת wrapper שלנו | ספריית לקוח מוכרת; ה-wrapper מבודד כדי לאפשר החלפה |
| אבטחת לקוח | WebCrypto + OS keychain + CSP | סטנדרטי ונבדק |
| Indexer | Node/TS + SQLite→Postgres | קריאה-בלבד, פשוט ב-MVP |
| CI/CD | GitHub Actions + SCA + changesets | איכות ושרשרת אספקה |

## 8. תוכנית פיתוח מדורגת (עם שערים)

```
Phase 0 ── שער M0: החלטת רשת (1–2 שבועות)
  ▸ אישור רשת יעד מבעל הפרויקט · סקר RPC endpoints חיים · אימות מפרט KDF/ops מול קוד מקור הרשת
  ▸ GATE: אין קוד חתימה לפני מעבר השער ⛔
Phase 1 ── MVP (8–10 שבועות)
  ▸ monorepo + keystore + Policy lite + Aurora Modes + Tri-Token Treasury (קריאה ועסקאות בסיס)
  ▸ Zero-Gate Onboarding (יצירת חשבון + סוללת RC) + indexer-lite + web-wallet shell
  ▸ סקירת אבטחה פנימית #1 בסוף ה-phase
Phase 2 ── Trust (4–6 שבועות)
  ▸ Memo Vault מלא · Governance Cockpit · Signal Hub · Recovery Circle · Policy מלא
  ▸ ביקורת חוץ (KDF/keystore) — חובה לפני beta ציבורי
Phase 3 ── Platform (6+ שבועות)
  ▸ SDK ל-dApps · Extension · Mobile · Watch Tower (QR signing)
```

**מילסטונים מפורטים, צוות ותזמון** — ב-`final-proposal.md` §6.

## 9. איכות ובדיקות

- **יחידה**: policy engine (כללים+קצוות), portfolio math, וקטורי KDF קבועים.
- **אינטגרציה**: adapter מול צומת בדיקה (testnet/צומת דוקר — זמינות לא אומתה, סעיף Open Questions); חתימה→שידור→אישור.
- **E2E**: happy paths של 5 ה-Cores; רגרסיית אבטחה (CSP, origin checks).
- **CI**: typecheck → lint → test → SCA → build דטרמיניסטי; חסימת merge על כישלון.

## 10. Open Questions (חייבות סגירה — מ-`missing-inputs.md`)

| שאלה | חוסמת | בעל ההחלטה |
|---|---|---|
| רשת יעד מדויקת (Steem? Hive? fork?) + chain id | M0 | בעל הפרויקט |
| RPC endpoint(s) חיים לפיתוח/בדיקות | M0 | בעל הפרויקט/קהילה |
| רישיון קוד הרשת והמאגר שלנו | פרסום ראשון | בעל הפרויקט |
| מפרט KDF/חתימה מדויק (קוד המקור של הרשת) | Phase 1 keystore | אימות הנדסי |
| תקציב ביקורת חוץ (Phase 2) | beta ציבורי | בעל הפרויקט |
