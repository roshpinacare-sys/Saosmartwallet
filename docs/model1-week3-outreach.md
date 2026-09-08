# Model 1 · Week 3 — ערכת Outreach ממוקדת

*2026-09-08 (Asia/Jerusalem) · הוכנה לפי התוכנית ב-`what-we-can-do-now.md`:
"רשימה של 10 פרוטוקולי DeFi שיש להם חשיפה למשתמשי Steem/Hive — לכל אחד דוא״ל אחת
עם קישור להוכחה החיה (לא מצגת — ה-demo שלנו)."*

**מתודה (Zero-Mock):** כל יעד נאסף מחיפוש-רשת אמיתי (11 שאילתות, 2026-09-08),
כל דומיין נבדק חי (HTTP מגיב — 200, או 403 = הגנת-בוט על דומיין חי).
וקטור-החשיפה של כל יעד מבוסס על מה שה-snippets הציבוריים אומרים במפורש —
לא על ניחושים. **סטטוס כן:** הדוא״לים למטה הם טיוטות מוכנות-לשליחה;
**השליחה בפועל היא פעולת-בעלים** (אין SMTP/credentials בסנדבוקס).

---

## 1. המוצר שאנחנו מוכרים (משפט אחד + מה כבר מוכח)

> **"הוכח שהחשבון הזה על Steem/Hive שייך לאותה נקודת-אליפטיקה שמחזיקה
> גם את כתובת ה-EVM הזו — עם ראיה על-שרשרת ציבורית — בקריאת API אחת."**

מה כבר מוכח וחי (ראה נספח A לאימות-עצמי של הלקוח):
- `POST /api/v1/identity/verify` — ממוסחר: מפתחות API (SHA-256-only),
  quota 1,000/יום UTC + headers, ledger של כל קריאה.
- המתמטיקה: עוגן `saos.id.v1` על-שרשרת → EIP-191 ecrecover →
  התאמת active-authority חיה על Steem+Hive (Blurt מדווח בכנות).
- SDK רשמי `saos-id-verify` (אפס תלויות) — דוגפוד חי 3/3 נתיבים.
- קריאת FAILED היא מדידה אמיתית ונספרת — אפס נתוני-דמה במערכת.

---

## 2. עשרת היעדים (כולם נבדקו חי ב-2026-09-08)

| # | יעד | קטגוריה | דומיין (חי) | וקטור-חשיפה ל-Steem/Hive (מה-search הציבורי) | למה זה קונה אצלם את ה-verify API | עדיפות |
|---|---|---|---|---|---|---|
| 1 | **Splinterlands** | משחק-מוביל ב-Hive | splinterlands.com ✅200 | "digital trading card game built on the Hive blockchain" (Alchemy/playtoearn/hive.blog) | קישור-חשבון בלי מפתחות-פרטיים + עמידות-סיביל מול ריבוי-חשבונות (בעיה ידועה במשחקי-p2e) | ⭐⭐⭐ |
| 2 | **MEXC** | CEX שמחזיק HIVE | mexc.com ✅403 | דף "Live HIVE to USD Price Chart & Market Data" חי באתר | ייחוס-הפקדות Graphene: משתמש מוכיח בעלות על `@account` מבלי לשלוח מפתח — פחות מקרי support, פחות הונאות-הפקדה | ⭐⭐⭐ |
| 3 | **Gate** | CEX שמחזיק HIVE | gate.com ✅403 | מדריך "What Is HIVE?" חי + רישום-מסחר (בכנות: נבדק Gate הגלובלי/US) | כמו MEXC — ייחוס-הפקדות והקצאת-כתובת בטוחה למשתמשי Graphene | ⭐⭐⭐ |
| 4 | **SimpleSwap** | מחליף-מיידי | simpleswap.io ✅200 | "HIVE to STEEM Exchange" חי באתר | ייחוס-הפקדות ללא-KYC כבד; הוכחת-בעלות על חשבון-מקור מקטינה החזרות/כיוונים-שגויים | ⭐⭐ |
| 5 | **Changelly** | מחליף-מיידי | changelly.com ✅403 | "STEEM to HIVE Exchange" חי ($20–$1M) | אותו וקטור — ייחוס-הפקדות חוצת-פרדיגמות (Graphene↔EVM) | ⭐⭐ |
| 6 | **Godex** | מחליף-מיידי | godex.io ✅200 | "STEEM vs HIVE" חי — "can be exchanged on many exchangers including Godex" | אותו וקטור + תמחור לפי-קריאה (free tier 1,000/יום) | ⭐⭐ |
| 7 | **Ecency** | social-frontend + rewards | ecency.com ✅403 | "frontend … distinctive … waves" (PeakD), הפרונטנד הנגיש-ביותר למשתמשים חדשים | עמידות-סיביל לחלוקת-rewards/points + "הוכח שאתה `@account`" לאפליקציות-צד-שלישי | ⭐⭐ |
| 8 | **InLeo** | social-fi (LEO) | inleo.io ✅200 | frontend חי של Hive עם כלכלת LEO (טרדים/מנויים) | חלוקת-rewards ו-UGC מטופלת בסיבילים = כסף ישיר; קישור-חשבון לכלים | ⭐⭐ |
| 9 | **PeakD** | הפרונטנד הגדול | peakd.com ✅200 | "the largest Hive frontend" (ביטוי חוזר ב-snippets) | UX-אימות-חשבון לכלים/שיתופים; בסיס-משתמשים = מכפיל | ⭐⭐ |
| 10 | **hive-bridge-eth** | גשר HIVE→EVM | github.com/mahdiyari/hive-bridge-eth ✅200 | "bridge contract for wrapping HIVE/HBD on Ethereum and compatible EVM chains" (GitHub ציבורי); המגמה: wrapped HIVE חי על ETH/BSC/BASE (הכרזת HIVEfest) | **הסיפור שלנו בדיוק**: קשירת-זהות בין החשבון הילידי לכתובת ה-EVM שמקבלת את ה-wrapped — עם אותו scalar, מוכח מתמטית | ⭐⭐⭐ |

**ספסל (מתועדים, לא בעשרייה):** dCity (gamified-DeFi על Hive-Engine) ·
NFT Showroom (marketplace אמנות על Hive) · Hive Keychain (wallet — ערוץ
הפצה ל-dApps) · 3Speak/Actifit (dApps חברתיים) · DappRadar קטגוריית-Hive
(מקור להרחבת-רשימה).

---

## 3. טיוטות דוא״ל (אנגלית — שפת-השוק; כל אחת ≤120 מילים)

### 3.0 תבנית-אב (מותאמת לכל יעד בסוגריים המרובעים)

> **Subject:** Proof-of-account for [Steem/Hive] users — 1 API call, on-chain evidence
>
> Hi [name/team],
>
> [Product] serves users who hold value on Graphene chains (Steem/Hive/Blurt).
> We built a metered API that answers the question you probably ask in support
> tickets every week: *does this person really control @account?* — plus, when
> relevant, *which EVM address is bound to the same key?*
>
> One call returns PROVEN/FAILED with on-chain evidence: an `saos.id.v1` anchor
> transaction on Steem, an EIP-191 signature that recovers the claimed EVM
> address, and the live active-authority match measured now. A FAILED verdict is
> a real measurement, honestly metered — no mock data.
>
> Free tier: 1,000 verifications/day. Zero-dep SDK in 3 lines. Evidence you can
> check without trusting us: Appendix A (public on-chain links).
>
> Would a free pilot key be interesting this week?

### 3.1 וריאנט CEX/מחליפים (יעדים 2–6)

> **Subject:** Cut Graphene deposit-support tickets — proof-of-account API
>
> Hi [team],
>
> Deposits from Steem/Hive accounts come with a unique problem: the memo/account
> attribution step is where tickets and fraud live. We run a metered
> proof-of-account API: your user proves control of `@account` — one call returns
> PROVEN with on-chain evidence (anchor tx + EIP-191 recovery + live
> active-authority match), or FAILED as an honest metered measurement.
>
> Free tier 1,000/day, no key-custody, 3-line SDK. Can we send you a pilot key?

### 3.2 וריאנט משחקים (יעד 1 + ספסל)

> **Subject:** Link @accounts without touching private keys (on-chain proof)
>
> Hi [team],
>
> Games on Hive fight multi-accounting and handle key-adjacent flows more than
> anyone. Our API lets you verify a player owns @account (and which EVM address
> shares the same key) with one metered call — evidence lives on-chain
> (`saos.id.v1` anchor + EIP-191), never in your DB. Free tier 1,000/day.
> Worth a pilot key?

### 3.3 וריאנט social-fi (יעדים 7–9)

> **Subject:** Sybil-resistant rewards — prove @account ownership via API
>
> Hi [team],
>
> Reward pools are only as good as your sybil defense. We offer a metered
> proof-of-account API for Graphene chains: one call, on-chain evidence,
> PROVEN/FAILED honestly measured, 1,000/day free. It also binds the same key to
> an EVM address — useful for cross-chain features. Pilot key?

### 3.4 וריאנט גשר (יעד 10)

> **Subject:** Native↔EVM identity binding for wrapped HIVE — same scalar, proven
>
> Hi [mahdiyari/team],
>
> Your bridge wraps HIVE/HBD onto EVMs. The missing piece we ship: proof that the
> @account that locked native tokens and the EVM address that receives wrapped
> tokens are the same secp256k1 scalar — anchor tx on-chain, EIP-191 recovery,
> live active-authority match, metered API, free tier. This is exactly our
> cross-paradigm anchor story. Pilot key?

---

## 4. נספח A — ההוכחה החיה שאפשר לשלוח ללקוח (מבלי לסמוך עלינו)

1. **העוגן על-שרשרת — ציבורי לחלוטין:**
   `https://steemworld.org/tx/53e4c7e4db38ef45d6aecbf300948213a8390c40`
   (block 109,389,994 — custom_json `saos.id.v1`, בתוכו: claimedEvm, msg, sig).
2. **שחזור המתמטיקה בעצמך:** קח את `msg`+`sig` מהעוגן → EIP-191 ecrecover
   רגיל → `0xF723186d21179672Ca6d9fc526Ffb718dbD99376` — ואז בדוק מול
   `condenser_api.get_accounts ["headcorner"]` שזהו אכן ה-active authority
   (הפרמטרים **מערכיים** — כך זה עובד מול Graphene).
3. **נסה את ה-API בעצמך:** נשלח לך מפתח `saos_live_…` חינמי:
   ```bash
   curl -X POST <BASE_URL>/api/v1/identity/verify \
     -H "Authorization: Bearer saos_live_…" \
     -H "Content-Type: application/json" \
     -d '{"username":"headcorner"}'
   ```
   בתשובה: `verify.sameScalarProof` · `anchor.block` · `meta.quota` ·
   `X-RateLimit-*` headers. נסה גם שם-משתמש שלא מעוגן — תקבל FAILED
   כנה שנספרת (כך נראה מוצר בלי mock).
4. **SDK:** `npm i saos-id-verify` (publish-ready; אם טרם פורסם — קוד-המקור
   בריפו: `packages/saos-id-verify/`, דוגפוד חי ב-`tools/m1-w2-sdk-dogfood.ts`).

> **הערת-כנות לשליחה:** הדשבורד/demo רץ על פריסת-הבעלים; BASE_URL ציבורי
> (דומיין ייעודי) היא החלטת-בעלים שתידרש לפני הפיילוטים — מסומן כך גם ב-worklog.

## 5. ערוצי-יצירת-קשר (ציבוריים; אימות-כתובות סופי = בעלים)

- CEX/מחליפים (2–6): דף contact/business/support באתר כל אחד; Splinterlands:
  support.splinterlands.com + ערוצי-ה-Discord הרשמיים; Ecency: Discord/Support
  ציבורי; InLeo/PeakD: עמוד-team/תמיכה; hive-bridge-eth: GitHub issues/PR +
  פרופיל המתחזק.
- **לא מומצא כאן:** אין כתובות-מייל אישיות במסמך זה — רק ערוצים רשמיים
  שהם public knowledge; רשימת-כתובות מדויקת היא פעולת-בעלים (שמירה על
  anti-spam וזכויות).

## 6. metric הצלחה (מהתוכנית, לא שונה)

> 3 integrations חיות ששולחות ≥100 אימותים/יום. אם אין — מדווחים בכנות
> ולומדים מהתנגדות-השוק; התשתית לא נפגעת.

קצב-מעקב מוצע: פינג ראשון אחרי 5 ימי-עסקים, שני אחרי 10, ואז המשך רק למי
שהגיב. כל שליחה נרשמת ב-worklog (תאריך, יעד, ערוץ).

## 7. איך מאמתים את המסמך הזה בעצמך

```bash
# חיות-דומיינים של העשירייה (403 = חי עם הגנת-בוט):
for u in https://splinterlands.com https://www.mexc.com https://www.gate.com \
         https://simpleswap.io https://changelly.com https://godex.io \
         https://ecency.com https://inleo.io https://peakd.com \
         https://github.com/mahdiyari/hive-bridge-eth; do
  echo "$(curl -s -o /dev/null -m 12 -L -w '%{http_code}' -A 'Mozilla/5.0' $u)  $u"; done

# המוצר חי עכשיו (fail-closed 401 בלי מפתח):
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/identity/verify -H 'Content-Type: application/json' -d '{}'
```
