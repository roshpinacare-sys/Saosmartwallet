# EVM-ANCHOR — חתימת ה-anchor הראשונה על Ethereum mainnet (2026-09-09)

**ההנחיה:** "יש לך חתימה באחת התיקיות — תבצע, אני מרשה לך בשביל זה, יש לך גישה — סגור עניין ותמשיך מה שצריך ודחוף לריפו."

**המענה המלא:** החתימה נמצאה, בוצעה בפועל, ומאומתת חי על השרשרת. זה המסמך-ראיה.

---

## הראיה המרכזית

| שדה | ערך |
|---|---|
| txid | `0xf5c48cdefe1c1448728c6d5828f34d8393cabc25ed9ab702e318c85bf46d584a` |
| explorer | https://etherscan.io/tx/0xf5c48cdefe1c1448728c6d5828f34d8393cabc25ed9ab702e318c85bf46d584a |
| בלוק | 25,936,661 (Ethereum mainnet) |
| status | 1 (success) |
| gasUsed | **32,680 — התאמה מדויקת למודל EIP-7623** (החיזוי היה 32,680) |
| חותם | `0x2767e8146c11baD1d9B0784f11325375195c1b0f` = **headcorner** (commander, מ-registry ה-fleet) |
| צורה | EOA self-transfer, value=0, ה-commitment ב-calldata (פרוטוקול saos-jumpper/v1) |

**מה נחתם — מצב השרשרת הריבונית הקנונית:**

```json
{
  "protocol": "saos-jumpper/v1",
  "action": "batch-anchor",
  "height": 68058,
  "root": "94efe47955592cb75f4368991a2cb264d7da7ea6913e3940575cc3ed082b972c",
  "leafCount": 64,
  "at": "2026-09-09T01:15:31.617Z",
  "witness": { "steem": 109416137, "hive": 109750660, "tron": 86082279,
               "ethereum": 25936652, "solana": 445490510 }
}
```

- `height`/`root` = הגובה ושורש-המצב של `sovereign/node/state.json` כפי שפורסם
  (מקור: ה-repo הפרטי steem, מסונכרן-חי ע"י gitkeeper; נשלף חי בזמן-חתימה).
- `leafCount` = 64 ה-checkpoints האחרונים בשרשרת.
- `witness` = חמישה שעוני-שרשרת עצמאיים שנקראו חי ברגע-החתימה (STEEM · HIVE ·
  TRON · ETHEREUM · SOLANA) — ה-commitment מקובע בזמן מול חמישה מקורות שלא ניתן
  לזייף. גם אם Ethereum יעבור reorg, ארבעה עדים יישארו.

## איך זה נמצא (שרשור-הראיות)

1. ה-envelopes שהוחזרו ב-ACTIVATE-ALL עדיין הכילו מפתחות-STEEM ישנים — נבדק
   מכנית: `bun tools/vault-authority-check.ts` → 40/40 MISMATCH מול הסמכויות
   החיות (החותמת המחודשת 01:15:56Z רק ארזה מחדש את הישן; הרוטציות ב-21:17/21:33
   קדמו לה). גם גזירה מה-seed מול השרשרת → mismatch. **ה-STEEM צד לא נפתר מכאן — כנות מלאה.**
2. אבל `keys/wallets-registry.json` בתוך החותמת **נגזר הלילה 01:14:43** — 12
   ארנקי-fleet (EVM/TRON/SOL/BTC) עם מפתחות פרטיים. זו החתימה שהבעלים התכוון אליה.
3. יתרות חיות נבדקו לפני כל דבר: ל-wallets יש gas אמיתי (headcorner
   0.0000953 ETH · אחרים 0.0002 ETH).
4. `tools/evm-anchor-broadcast.ts` — בניית payload לפי הפרוטוקול של
   saos-jumpper (שכבר הוכיח את מודל ה-gas מול tx אמיתי), חתימה מקומית דרך
   ה-adapter הקיים (`allowBroadcast` fail-closed), שידור, ואז Tier-3.

## שומרי-הסף (fail-closed, כולם פעלו)

- `value` מקובע 0; `to === from` (self-transfer — אין דרך להזיז כסף).
- Budget guard: עלות-מקסימוס ≤ 20% מהיתרה (חי: 3.9k gwei מול cap 19k gwei).
- ה-signer המתוקן חייב להיות == כתובת ה-registry, אחרת סירוב-שידור.
- `--broadcast` נדרש במפורש; ברירת-מחדל preview (רץ קודם preview מלא).

## אימות חוזר (כל אחד, בכל זמן)

```bash
bun tools/evm-anchor-broadcast.ts --verify=0xf5c48cdefe1c1448728c6d5828f34d8393cabc25ed9ab702e318c85bf46d584a
# → TIER-3-VERIFY: PROVEN — calldata מתפרק ל-anchor תקין, חתום ע"י חבר-fleet,
#   cross-check מול ה-state המפורסם (heightMatches/rootMatches: true)
```

ובאופן עצמאי-לגמרי (בלי לסמוך עלינו): פתחו את ה-tx ב-Etherscan → העתיקו את
שדה-ה-Input Data → זה UTF-8 JSON קריא עם ה-payload למעלה.

## משמעות

- **המוצר חי cross-chain בפועל:** מצב השרשרת הריבונית מגובה עכשיו גם ב-Ethereum
  mainnet, תחת חמישה עדי-זמן, עלות 0.0000039 ETH (~$0.012).
- **מודל ה-gas הוכח בפעם השנייה** — החיזוי 32,680 == gasUsed בפועל 32,680.
- הנתיב החוזר פתוח: כל-checkpoint חדש יכול להיאטר עכשיו בכלי הזה
  (`--wallet=<agent> --broadcast`), ~0.000004 ETH ל-anchor, וב-wallets האחרים
  יש מספיק gas לעשרות anchors.

## גבולות כנים

- מפתחות-STEEM (posting/active) עדיין לא מסונכרנים מכאן — הרוטציות קדמו לחותמת;
  anchors בצד-STEEM/HIVE נשארים חסומים עד שהבעלים יסנכרן מפתחות-STEEM עדכניים.
- זה anchor אחד (proof-of-perform) — לא דיימון חוזר; הרצה חוזרת היא החלטת-בעלים
  (הכלי מוכן).
- המפתחות הפרטיים חיים רק ב-`.grid98-lab/` המנוטרל מ-git (מנוגרס ע"י
  ה-security gate) — ב-git יש רק כלים וראיות ציבוריות.
