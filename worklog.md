# Worklog

---
Task ID: 1
Agent: Z.ai Code (main)
Task: יצירת סביבת עבודה הנדסית engineering/zip-analysis-20260907-1520 — סריקת סביבה לקובצי ZIP ולרכיב "steem main", כתיבת דוחות, המלצה מותנית, תוכנית פריסה, ו-commit.

Work Log:
- נבדק קובץ ה-upload היחיד (Roshcaregt.txt, 40 בייטים) — מכיל placeholder של טוקן GitHub מחוסם; תוכנו לא צוטט בשום מסמך תוצר.
- נוצר מבנה תיקיות מלא: 00_input, 01_extracted, 02_reports, 03_code_analysis, 04_architecture, 05_recommendation, 06_deployment_plan, 07_scripts.
- נכתב סקריפט סריקה 07_scripts/environment-scan.sh בארבע גרסאות (לקחים מתועדים):
  - v1: החרגת '!node_modules/**' גרמה לירידה לתוך node_modules (1.2GB) → timeout.
  - v2: 'rg --files-from' אינו נתמך בסביבה → תוצאות "no matches" כוזבות; תוקן.
  - v3: כפילויות עקב סריקת my-project דרך שני שורשים + self-match של הסורק; תוקן.
  - v4 (סופית): רשימת קבצים deduped + מסוננת-עצמית, חיפושי תוכן דרך xargs -d '\n', סיווג toolchain, בדיקות סודות בוליאניות בלבד. ריצה מאומתת: ~12 שניות, 111,262 קבצים במפלג המלא, 2,108 ברשימה האפקטיבית.
- כל התאמה לא-אפסית למילות מפתח אומתה בהקשר: 'steem' ב-HTML = substring ב-base64 ('...M0sTEeM...'); 'dpos' = substring ב-data-URI; התאמות 'node'/'api'/'token' = Next.js scaffold / node-compile-cache / tokens.css. אפס התאמות אמיתיות.
- נכתבו תוצרים: 02_reports/environment-scan.md (דוח סריקה מסונן), 02_reports/missing-inputs.md (דוח חסרים), 03_code_analysis/README.md + analysis-template.md (תבנית 23 שדות), 04_architecture/README.md, 05_recommendation/final-recommendation.md (13 סעיפים, מסומנת כמותנית), 06_deployment_plan/deployment-roadmap.md (מסומן כמותנה), README.md ראשי.
- נשמרו כללי בטיחות: קריאה בלבד, אין חילוץ ארכיונים, אין הרצת קוד, אין חשיפת סודות, לא נמחק/שונה תוכן קיים.

Stage Summary:
- ממצא מרכזי מבוסס ממצאים: אין ZIP ואין שום עקבות של steem/steemd/בלוקצ'יין בסביבה — המשימה חסומה עד קבלת קלט.
- כל תוצרי ההמלצה/פריסה מסומנים במפורש כמותנים (הנחה: Steem ציבורי) ולא כמבוססי קוד.
- Git: branch main, לא מוגדר remote — commit מקומי בלבד; push דורש הגדרת remote (תועד כנה בדוחות).
- ארטיפקטים: engineering/zip-analysis-20260907-1520/ (README ראשי + 8 תיקיות + 11 קבצים).

---
Task ID: 3-prep
Agent: Z.ai Code (main)
Task: לפני ביצוע שלב 3 המלא — בדיקה מעמיקה של כל התיקיות והארכיונים (בקשת משתמש: "תכין את עצמך", בלי ביצוע).

Work Log:
- סריקת סיומות ארכיונים (zip/tar/gz/7z/rar/tgz/xz/bz2) על כל הפרויקט: 0 תוצאות — מאשר את שתי הסריקות הקודמות (v4, 111K קבצים).
- נבדקו: worklog.md, download/README.md (סטטי), tool-results/, /home/z/TODO (רשימת משימות פלטפורמה שלי — לא חומר משתמש), mini-services/ (ריקה), examples/ (websocket בלבד), skills/ (~40+ תיקיות כלים של הפלטפורמה).
- אומת git: branch main; wallet-design/ נכלל ב-commit מערכתי 737027c; אין remote מוגדר; עץ עבודה נקי מלבד tool artifact אחד לא-עקוב.
- נבדקו מסמכי שלב 2: README ראשי (BLOCKED — MISSING INPUTS), missing-inputs.md, וכן wallet-design/network-analysis.md (הושלם) + network-scan-raw-output.md (הושלם).
- לא בוצע ביצוע של המסמכים הנותרים לפי בקשת המשתמש ("רק תכין את עצמך").

Stage Summary:
- המלאי בידיים: (א) חומרי משתמש אמיתיים = קובץ upload/Roshcaregt.txt (40 בייטים, טוקן מחוסם) בלבד + הקשר שיחה; (ב) סקפולד פלטפורמה Next.js — לא המוצר של המשתמש; (ג) תוצרי עבודה שלי: engineering/ שלם (13 קבצים, 167a010) + wallet-design/ חלקי (2 מתוך 5 קבצים).
- החשש של המשתמש "אתה מתכוון למוצר שלך" — מוצדק: כל מה שקיים בפועל הוא סקפולד פלטפורמה; ה"רשת" היא הנחה מסומנת מהשיחה (network-analysis.md סעיף 1 מציין זאת במפורש).
- מוכן לביצוע ברגע אישור: breakthrough-ideas.md, wallet-architecture.md, final-proposal.md, עדכון README, commit, remote+push (דיווח כן/לא בכנות).

---
Task ID: 3-prep-2
Agent: Z.ai Code (main)
Task: בדיקה מחודשת עם הקובץ שהועלה שוב (Roshcaregt.txt) — אימות מלא של הטוקן, ה-repo והסביבה לפני ביצוע, בלי לבצע.

Work Log:
- הקובץ upload/Roshcaregt.txt (40 בייטים) נבדק שוב: הפעם טוקן GitHub classic PAT תקין (ghp_); תוכנו לא צוטט, לא הוצג ולא נשמר בשום מסמך תוצר.
- אימות GitHub API (/user): HTTP 200, חשבון roshpinacare-sys (User, נוצר 2026-09-07); היקף הרשאות רחב מאוד (repo, workflow, delete_repo, admin:org ועוד).
- אימות ה-repo המטרה roshpinacare-sys/Saosmartwallet: קיים, פרטי, ריק לחלוטין (0 KB, אין branches, "This repository is empty"), default branch main; הרשאות הטוקן עליו: admin/maintain/push/triage/pull.
- אימות ערוץ git-over-HTTPS: ls-remote עם הטוקן (קריאה בלבד, ללא push) — exit 0, אין refs; ה-push אפשרי מבחינת אימות.
- סריקת ארכיונים מחודשת (zip/tar/gz/7z/rar/tgz/xz/bz2, ללא node_modules/.next/.git): 0 תוצאות — מאשר את שלוש הסריקות העצמאיות.
- מצב git מקומי: branch main, אין remote מוגדר, עץ עבודה נקי; היסטוריה: 167a010 (engineering), 737027c (wallet-design חלקי), e6997eb (אחרון).
- נקראו wallet-design/network-analysis.md + network-scan-raw-output.md (שלמים) ו-engineering/README.md (BLOCKED — MISSING INPUTS — נכון לתקופה שלפני הטוקן התקין).
- זוהה תיקון-לביצוע: שורת "placeholder טוקן מחוסם" ב-network-analysis.md וב-README של engineering אינה נכונה עוד — יעודכנו בשלב הביצוע עם ה-commit.

Stage Summary:
- שינוי מהותי מההכנה הקודמת: הטוקן אמיתי, תקין ובעל הרשאת push על ה-repo המטרה — החסם המרכזי מהדוחות הקודמים (remote/אימות) נפתר.
- המלאי המלא: (א) טוקן תקין + repo ריק מאומת מקצה לקצה; (ב) אפס ZIP ואפס קוד בלוקצ'יין בסביבה (3 סריקות); (ג) תוצרים קיימים: engineering/ שלם + wallet-design/ חלקי (2/5 קבצים); (ד) חסרים לביצוע: breakthrough-ideas.md, wallet-architecture.md, final-proposal.md, עדכון README ראשי, remote+push.
- הכנה הושלמה; ביצוע רק באישור המשתמש. המלצת אבטחה שהועברה: הטוקן בהיקף רחב מאוד — מומלץ לצמצם היקף או לשלול אותו לאחר השימוש.

---
Task ID: 3-execute
Agent: Z.ai Code (main)
Task: ביצוע מלא באישור המשתמש — כתיבת 3 המסמכים החסרים ב-wallet-design/, תיקון התייחסויות "placeholder מחוסם", README ראשי, commit, ניקוי סודות מהיסטוריה, remote+push ל-Saosmartwallet.

Work Log:
- שלב 1א: נכתב wallet-design/breakthrough-ideas.md — 15 רעיונות מדורגים (Impact×Feasibility, Score מקס' 25), עם מיפוי נכס-רשת-מנוצל לכל רעיון; המלצה על 5 Core (Aurora Modes 25, Zero-Gate Onboarding 20, Tri-Token Treasury 16, Memo Vault 15, Governance Cockpit 15) + 3 Rails (Password-First Keys, Policy Engine, In-app Signals); רשימת אי-הכללות מפורשת.
- שלב 1ב: נכתב wallet-design/wallet-architecture.md — עקרונות (network-agnostic core + adapter, מפתחות בלקוח בלבד, least-privilege, fail closed), דיאגרמות ASCII (רכיבים + זרימת חתימה), מבנה מונורפו מלא (apps/packages/services/tools + חוקי תלות), סקיצת ChainAdapter, אבטחה (מחזור חיי מפתחות, Policy Engine, CSP/quorum, threat model 7 איומים, הצהרת אי-תחום), indexer קריאה-בלבד, תוכנית Phase 0–3 עם שער M0, בדיקות/CI, Open Questions.
- שלב 1ג: נכתב wallet-design/final-proposal.md — חזון, MVP 5 Core+3 Rails עם ערך מדיד, סטאק, מבנה משלוח, מילסטונים M0–M4 (~12 שבועות צוות / 4–5 חודשים סולו), סיכונים 8 עם מיגון, מדדי הצלחה, נקודות החלטה D1–D5 לבעל הפרויקט, checklist.
- שלב 2: תוקנו כל ההתייחסויות המיושנות ל"placeholder מחוסם" עם סימון ✏️ עודכן 2026-09-07 ב-6 מסמכים: network-analysis.md, engineering/README.md, environment-scan.md, missing-inputs.md, deployment-roadmap.md, final-recommendation.md; ב-2 קובצי raw scan (network-scan-raw-output.md, scan-raw-output.md) נוספה הערת תיקון מתוארכת בראש המסמך — גוף הראיות נשמר לא-משוכתב.
- שלב 3: נוצר README.md ראשי בשורש — סטטוס, מפת מסמכים (5 לינקים), החלטות מרכזיות, דרישות D1–D5, הערות אבטחה למאגר. נוסף /upload/ ל-.gitignore.
- שלב 4 (הכנות): זוהתה חשיפה — `.env` ו-`upload/Roshcaregt.txt` (הטוקן!) עוקבים ב-git מאז commit a1c0dd1; לפני push ינוקו מההיסטוריה כולה (git filter-branch, בטוח — ה-repo המרוחק ריק), reflog יפוג ו-gc ירוץ; hashes ישתנו וזה מתועד כאן.

Stage Summary:
- wallet-design/ הושלמה: 5/5 מסמכים (network-analysis, network-scan-raw-output, breakthrough-ideas, wallet-architecture, final-proposal).
- שרשרת המסמכים עקבית: הנחה מסומנת בכולם; ליבה network-agnostic; שער M0 חוסם קוד חתימה עד אישור רשת/RPC.
- אבטחה: .env + upload/ ינוקו מהיסטוריית git לפני push; הטוקן לא צוטט בשום מסמך; המלצה לצמצם/לשלול את הטוקן לאחר השימוש.
- Push מתוכנן ל-origin = github.com/roshpinacare-sys/Saosmartwallet עם ההודעה: feat: add breakthrough wallet design based on network analysis; תוצאת ה-push תדווח כן/לא בכנות בסיום.

---
Task ID: 3-execute-result
Agent: Z.ai Code (main)
Task: תיעוד תוצאות סופיות — ניקוי היסטוריה, push ואימות מקצה לקצה.

Work Log:
- git filter-branch הסיר `.env` + `upload/Roshcaregt.txt` מכל 6 ה-commits; refs/original נמחקו, reflog פג, gc --prune=now רץ.
- תופעה מתועדת: filter-branch סינכרן את עץ העבודה ל-HEAD המשוכתב ומחק את שני הקבצים מהדיסק; שוחזרו: הטוקן מ-`/tmp/my-project/upload/Roshcaregt.txt` (40 בייטים, snapshot מתועד בסריקה), ו-.env נוצר מחדש (`DATABASE_URL="file:../db/custom.db"` — תואם למקור 50 בייטים/שורה אחת; תוכן המקור מעולם לא נקרא).
- אימות היסטוריה מול הטוקן האמיתי: git grep על כל revs — הטוקן לא נמצא בשום blob ✓; commits עם .env/upload: 0 ✓.
- git remote add origin https://github.com/roshpinacare-sys/Saosmartwallet.git; push -u origin main עם http.extraheader (Basic, טוקן מהקובץ, לא נשמר ב-config) — exit 0, "new branch main -> main".
- אימות מרוחק: ls-remote = refs/heads/main d0e150ff4af792e0ba848e38b25668eab8918fba = SHA מקומי ✓; API contents: 24 פריטים בשורש כולל README.md, wallet-design/, engineering/, worklog.md; wallet-design/ = 5 קבצים (breakthrough-ideas 15972B, final-proposal 10536B, network-analysis 7149B, network-scan-raw-output 17813B, wallet-architecture 16717B); upload/ במרוחק = "Not Found" ✓; .env במרוחק = לא קיים ✓.
- הערה: hashes השתנו עקב השכתוב — 167a010/737027c/e6997eb/104124e היסטוריים; HEAD הסופי במקום ובמרוחק: d0e150f.

Stage Summary:
- ✅ Push הושלם בהצלחה ל-Saosmartwallet (private), branch main, HEAD d0e150f, מאומת ב-API וב-ls-remote.
- ✅ אפס סודות בהיסטוריה ובמרוחק: .env ו-upload/ חסרים מה-histogram ומה-commit הראשון ועד הראש.
- ✅ wallet-design/ 5/5 מסמכים במאגר; README ראשי עם לינקים; commit message: "feat: add breakthrough wallet design based on network analysis".
- מומלץ לבעל החשבון: לצמצם היקף הטוקן ל-repo או לשלול אותו לאחר האימות.

---
Task ID: M0-prep
Agent: Z.ai Code (main)
Task: אימות עצמאי של מצב הריפו לאחר הניקוי+push (על בסיס הודעת תיאום חיצונית — "לא סומך על טענות"), והכנת groundwork לשלב M0 שאינו תלוי בהחלטות D1/D2.

Work Log:
- אימות עצמאי מלא של טענות ההודעה: (א) אפס הופעות של ערך הטוקן האמיתי ושל צורת ghp_ מלאה בכל blob בהיסטוריה כולה (git grep על כל revs) ✓; (ב) אפס עצים היסטוריים המכילים .env או upload/ ✓; (ג) .gitignore מכסה .env* ו-/upload/ ✓; (ד) הריפו המרוחק עומד על d0e150f עם 5/5 מסמכי wallet-design בגדלים המדויקים ✓; (ה) עץ מקומי נקי, main מקומי מקדים את origin ב-commit אחד (f45dfdc — auto-commit של הפלטפורמה: tool-results + 19 שורות worklog, תוכן תמים, נסרק לסודות לפני push) ✓.
- נמצא ודווח: הטוקן עדיין חי (HTTP 200 ל-repos + rate_limit) — פעולת ההיגיינה #1 (שלילת טוקן) טרם בוצעה על-ידי הבעלים.
- נכתב tools/chain-health-check.ts — פרוב קריאה-בלבד (אין מפתחות/סודות/כתיבה): version, chain id (2 namespaces), dgp+lag, account, RC manabar; יציאות 0/1/2/3; פלט human + --json; אפס תלות חיצוניות.
- ריצה אמיתית ראשונה מול https://api.steemit.com חשפה שני לקחים אמפיריים ותוקנו בקוד: (1) condenser_api דורש פרמטרים מערכיים — {} מחזיר "Bad Cast: Invalid cast from object_type to Array"; (2) שדה זמן הראש בצומת זה הוא time ולא head_block_time; בנוסף "method not found" ב-chain id מסווג warn (מגבלת צומת) ולא fail.
- ריצה סופית מאומתת: HEALTHY (exit 0) — blockchain_version 0.23.0, head block ~109.4M, lag 2–3s, namespaces חיים condenser_api+rc_api, חשבון steem נמצא, RC manabar נשלף; chain id אינו נחשף בשני ה-namespaces — פער ראיות מסומן המשפיע על D2.
- נכתב packages/chains/chain-adapter.ts — ממשק ChainAdapter קפוא (interface בלבד, ללא מימוש, מוגן שער M0); נכתבו packages/README.md, packages/crypto/README.md, packages/core/README.md (היקף, כללי איכות: test vectors חובה/אין קריפטו ביתי/איסור יבוא chains ב-core, תנאי כניסה ל-M0).
- README ראשי עודכן: סעיף Groundwork ל-M0 עם טבלת נכסים, ראיות אמפיריות מתוארכות, פקודת הרצה, והלקח ההנדסי המאומת.

Stage Summary:
- כל טענות הודעת התיאום אומתו באופן עצמאי ומדויקות; הריפו נקי מסודות מקצה לקצה (ביקורת חוזרת שלי, לא רק התיעוד הקודם).
- Groundwork ל-M0 חי במאגר: כלי health-check רץ ומאומת מול צומת אמיתי + ממשק ChainAdapter קפוא + סקפולד packages מתועד; כל הרכיבים מסומנים ASSUMPTION ומוגני שער M0 — אפס קוד חתימה לפני D1/D2.
- ראיות רשת ראשונות בפועל (לא הנחה): צומת Steem ציבורי חי, ver 0.23.0, rc_api זמין — ו-chain id חסר בצומת הציבורי, רלוונטי להחלטת D2.
- נותר פתוח אצל בעל הפרויקט: D1/D2 (רשת+RPC) לשחרור ה-M0 gate; שלילת/צמצום הטוקן הרחב (עדיין חי).

---
Task ID: M0-impl
Agent: Z.ai Code (main)
Task: מימוש M0 Core באישור הבעלים (טוקן נשאר פעיל; רשת = Steem Protocol): חבילת crypto, מנוע serialization ל-Steem, SteemAdapter, סוויטת אימות מול chain חי, תיעוד, commit ו-push.

Work Log:
- deps קריפטוגרפיות אומתו: @noble/curves@2.4.0 + @noble/hashes@2.4.0 + @scure/base@2.4.0; נבנה על APIs בלבד (noble v2: sign מחזיר Uint8Array(64); 65B 'recovered' פורמט = [recid, r, s]).
- לכידת ראיות מה-chain לפני כתיבת serializer (עקרון "אין ניחושים"): מיני-serializer זמני שיחזר עסקאות אמיתיות — 4/4 עסקאות vote עם עסקה-מעטפת מתאימות tx-id; שתי השערות Asset (15B/14B) נכשלו מול 20 עסקאות transfer; condenser_api.get_transaction_hex נמצא כ-oracle קנוני; ניתוח hex חשף: **Asset = 16 בייטים** (int64 + precision byte + 7-char ריפוד-אפס) — הראיה: `01…00 | 03 "STEEM" 00 00` + memo varint; get_transaction_hex = tx bytes + וקטור חתימות (varint 0 כשאין חתימות); checksum של מפתח ציבורי "STM" חולץ ממחרוזת on-chain אמיתית = **ripemd160(pub33)[0:4]** ישירות (לא ripemd160(sha256()) — זיכרון תוקן מול ראיות); header של חתימות אמיתיות = 0x1f/0x20 → recid = header−31; שמות חשבונות מכילים נקודות (wakeupkittty.pal נצפה).
- נכתב packages/chains/steem/src/serializer.ts — ByteWriter/ByteReader (u8/u16/u32/i64/varint/string) + Asset pack/unpack (16B) + parseAsset/formatAsset ללא floats (BigInt בלבד), fail-closed על סימולים לא-ידועים.
- נכתב packages/chains/steem/src/operations.ts — ריסטר op-ids סטנדרטי; transfer (id 2) ממומש pack/unpack; ops לא-נתמכים נזרקים בבירור.
- נכתב packages/chains/steem/src/transaction.ts — מעטפת serialize/deserialize, transactionDigest = sha256(chain_id‖tx) (chain id Steem = 32 אפסים), transactionId (sha256[0:40]), appendSignatures (wire: tx + varint(count) + 65B sigs).
- נכתב packages/crypto/src/{encoding,keys,index}.ts — WIF (0x80 + double-sha256 checksum), STM encode/decode (ripemd160(pub) checksum), PrivateKey/PublicKey, signRecoverable → [31+recid, r, s], verify = recovery-and-compare (כמו ה-chain), derivePrivateKey = sha256(account+role+password), generateMasterPassword = "P"+WIF, normalizeBrainKey + deriveFromBrainKey (cli_wallet סמנטיקה, flag ל-lowercase).
- נכתב packages/chains/steem/src/adapter.ts — SteemAdapter implements ChainAdapter: health/getAccount/getBalances/getRcManabar (JSON-RPC), buildOperations (ref_block_num=head&0xFFFF, prefix=LE u32 של head_block_id[4:8], expiration=+60s), sign עם policy (אסור לחתום transfer עם posting key), broadcast **נעול** כברירת מחדל (allowBroadcast:true בלבד) — capability "broadcast" מפורסם רק אז.
- נכתב tools/serialize-test.ts — קריטריוני קבלה מול chain חי: (1) זהות ביט-אחר-ביט מול get_transaction_hex (עם וקטור חתימות ריק), (2) sha256(bytes)=transaction_id, (3) round-trip deserialize→serialize, (4) recovery של חתימות אמיתיות מול authority on-chain, (5) self-tests: WIF/STM round-trip+tamper, חתימה/אימות, גזירות, assets.
- איתור באגים תוך כדי: recid-first פורמט noble v2 (מכאן "invalid recovery id"), באג .result כפול ב-probe שגרם ל-false-fails, אורך STM משתנה (test תוקן לבדיקת payload 37B).
- תוצאה סופית: **30/30 PASS, exit 0** — כולל 10/10 עסקאות BIT-IDENTICAL מול serializer הצומת, 10/10 tx-id anchors, ו-2/2 חתימות אמיתיות ששוחזרו ל-authority ה-on-chain; בדיקת adapter מקומית: sign→recover PASS, policy gate PASS, broadcast FAILS CLOSED.
- READMEs עודכנו (packages/README.md, packages/crypto/README.md, packages/chains/steem/README.md חדש) + README ראשי (הצהרת תקפות מעודכנת — ההנחה הפכה למאומתת; סעיף M0).

Stage Summary:
- M0 Core שלם ומאומת: crypto + serialization + adapter, עם שרשרת ראיות מלאה מול chain חי; ההצהרה "אין ניחושים" הוכחה בפועל — 3 הנחות זיכרון שלי נפלו מול bytes אמיתיים ותוקנו מהראיות (Asset 16B, STM checksum, oracle-הכולל-חתימות-ריקות).
- אבטחה: אפס סודות בקוד; broadcast נעול כברירת מחדל; policy מונע transfer עם posting key; כלי האימות קריאה-בלבד ולא שולח שום חתימה.
- פתוח ל-M1: packages/core (keystore AES-256-GCM + Policy Engine/Aurora Modes), ולאחר מכן indexer + apps/web-wallet.
- פעולה שעדיין תלויה בבעלים: הטוקן הרחב נשאר חי לפי החלטתו — הסיכון מתועד, מומלץ לצמצם היקף ל-repo בלבד.

---
Task ID: M1-impl
Agent: Z.ai Code (main)
Task: Phase M1 — DEX UI & Wallet Dashboard: live STEEM/SBD trading terminal on the M0 engine (limit_order_create serialization, market client, API routes, terminal UI), verification with live chain data, docs, commit & push.

Work Log:
- החלטת ארכיטקטורה מסומנת: הבקשה המקורית דיברה על apps/web (Vite), אבל הסנדבוקס חושף רק את אפליקציית Next.js בפורט 3000 דרך Preview Panel — ה-DEX נבנה בתוך ה-Next.js הקיים עם בדיוק הסטאק המבוקש (React+TS+Tailwind+shadcn/ui+Framer Motion+TanStack Query, כבר ב-deps).
- ראיות לפני קוד (עיקרון "אין ניחושים", אותה מתודולוגיית M0): עשרות probes חיים מול api.steemit.com — get_order_book (asks/bids עם order_price/real_price/steem/sbd ב-satoshis, ממוינים best-first) · get_ticker · get_trade_history דורש 2-3 ארגומנטים בלבד (לא 5 כמו ב-API ישן) וחלון [start=ישן, stop=חדש] · get_account_history = 3 ארגומנטים · get_open_orders.
- ראית serialization ל-limit_order_create: שני וקטורים סינתטיים דרך condenser_api.get_transaction_hex (ה-serializer הקנוני של הצומת) פוענחו ביט-אחר-ביט: varint(5) ‖ owner ‖ u32 orderid ‖ Asset×2 (16B) ‖ u8 fill_or_kill ‖ u32 expiration — כולל boundary (orderid=0xffffffff, fok=true, אמאונט-אפס).
- הורחב מנוע M0: operations.ts (LimitOrderCreateOperation + pack/unpack עם fail-closed על fok byte>1) · adapter.ts (buildOperations מקבל limit_order_create עם ולידציה מלאה: שמות, orderid uint32, STEEM/SBD בלבד, צדדים מנוגדים, חיי פקודה 1min..7d; sign() ממפה by-type דרך toWireOperation; policy: פקודות כספים דורשות ACTIVE — posting נדחה; broadcast מוכלל לשני סוגי ops ונשאר fail-closed).
- tools/m1-op-test.ts — סוויטת קבלה: 3 וקטורי oracle (כולל וקטור sell גדול עם סכומים אי-זוגיים) — bit-exact vs צומת + round-trip מה-hex של ה-oracle + tx-id anchors + self-tests של assets. תוצאה: **27/27 PASS** (אחרי תיקון: oracle hex כולל וקטור חתימות ריק בסוף — מוסר לפני round-trip).
- packages/chains/steem/src/market.ts (חדש, קריאה-בלבד): SteemMarketClient — orderbook/ticker/history/chainStatus/openOrders, מנורמל מהראיות; אמאונטים בשלמים (satoshis) עם פורמט עשרוני ללא floats; ה-seam הקפוא chain-adapter.ts לא שונה.
- API routes (Next.js App Router): /api/steem/market (ticker+dgp) · /api/steem/orderbook · /api/steem/history · /api/steem/wallet (יתרות+RC+SP בהמרת שלמים+פקודות פתוחות) · POST /api/steem/trade/build (BigInt math: BUY=ceil/SELL=floor על 1e6 price scale, orderid מ-timestamp, ref-block fields מה-adapter, serializedHex+digestHex+txId; אין מפתחות, אין שידור).
- באגי סביבה שתוקנו: Turbopack לא פותר relative imports עמוקים ל-packages — נוצר src/lib/steem-engine.ts (re-export barrel) ו-steem-server.ts (adapter fail-closed singleton); סיומות .js הוסרו מ-imports יחסיים (ושוחזרו על bare imports של @noble v2 שמחייבים אותן ב-exports map); dev server הופעל מחדש עם ניקוי .next.
- UI (דארק-אונלי, Bloomberg×Cyberpunk): globals.css (פלטת oklch ירוקה-כהה, .glass glassmorphism, .num mono tabular, flash-up/down keyframes, led-pulse, גריד blueprint, scanlines, scrollbars) · DexHeader (quote strip עם FlashNumber+chain vitals) · OrderBook (סולם asks/bids עם depth bars, לחיצה מזריקה מחיר לטרמינל, AnimatePresence) · TradeHistory (tape חי ממוין newest-first) · TradeTerminal (BUY/SELL tabs, BID/MID/ASK presets, % יתרה, lifetime select, fill-or-kill, Dialog preview: op payload+envelope+hex+digest+txId+שער "SIGNING LOCKED — M2") · WalletPanel (4 כרטיסים כולל RC gauge מונפש + טבלת פקודות פתוחות) · StatusFooter דביק (mt-auto, min-h-screen flex-col).
- באגים שאימות הדפדפן תפס ותוקנו: (1) מפתחות React כפולים בספר (שתי פקודות באותו מחיר+שעה) — אינדקס נוסף ל-key; (2) ReferenceError ב-BookRow (onClick קרא ל-onPickPrice במקום onPick) — ה-prefill לא עבד; (3) **באג M0 אמיתי**: getRcManabar קרא max_rc מתוך rc_manabar אבל ב-wire הוא ברמת החשבון — percent היה תמיד 0; תוקן ואומת (@steem: 24.8%); (4) sync של zustand persist אחרי rehydration (adjust-during-render, בלי effects — עומד בכלל react-hooks/set-state-in-effect); (5) אי-עקביות עיגול Cost/Receive — floor לגריד satoshi כמו השרת.
- אימות מקצה לקצה ב-agent-browser: page render תקין, אפס שגיאות קונסולה, נתונים חיים זורמים (ticker/orderbook/history/wallet/RC), golden path מלא: track @steem → לחיצה על שורה בספר → הזרקת מחיר+היפוך צד → SELL 500 STEEM @0.096555 → preview dialog עם payload/hex/digest → ראיית השער; מובייל 390px ודסקטופ 1440px נבדקו ויזואלית; footer דביק נבדק.
- ראיית קצה: פקודה שנבנתה דרך ה-API (BUY 100 STEEM @ 0.098 → 9.800 SBD → 100.000 STEEM, 60 בייטים) נשלחה ל-oracle וחזרה **BIT-EXACT** מול ה-serializer של הצומת.
- lint נקי · serialize-test 30/30 · m1-op-test 27/27 · READMEs עודכנו (ראשי + packages + steem) עם סעיף M1 וראיות.

Stage Summary:
- M1 מושלם: ה-DEX חי בדפדפן עם נתוני chain אמיתיים בלבד — אפס mock data; כל מספר במסך מגיע מ-api.steemit.com דרך ה-packages שלנו.
- שרשרת הראיות הוארכה: limit_order_create מאומת bit-exact (3 וקטורי oracle + בדיקת קצה של פקודה שנבנתה ב-API) — מנוע הסריאליזציה מוכן לחתימה בפועל ברגע שה-keystore (M2) יסופק.
- באג M0 נתגלה ותוקן בזכות ה-UI חושף-הנתונים (RC manabar) — העיקרון "ה-UI מאמת את ה-backend" שוב שילם.
- אבטחה נשמרת: אפס מפתחות בכל שרשרת ה-M1; ה-adapter ב-API נבנה fail-closed; הטרמינל מציג את השער במפורש.
- פתוח ל-M2: packages/core (keystore AES-256-GCM + Policy Engine/Aurora Modes) — ברגע שיסופק, כפתור החתימה מתחבר ל-digestHex שכבר מוצג.
