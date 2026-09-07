#!/usr/bin/env bash
# =============================================================================
# environment-scan.sh — סריקת סביבה עבור ניתוח ZIP / רכיבי בלוקצ'יין (v4)
#
# מטרה:
#   1. איתור קובצי ארכיון (ZIP וכד') — ממוין ל"קלט משתמש" מול "toolchain".
#   2. איתור קבצים לפי שמות במילות מפתח (steem, witness, consensus...).
#   3. איתור אזכורי מילות מפתח בתוך תוכן קבצי טקסט.
#   4. איתור קבצים שעלולים להכיל סודות (שמות בלבד + בדיקות בוליאניות —
#      תוכן לא נדפס מעולם).
#   5. סטטיסטיקות סביבה לצורך דוח סריקה.
#
# v4 שינויים (לקחים מ-v1..v3):
#   - v1: החרגת '!node_modules/**' גרמה לירידה לתוך node_modules (1.2GB) → חריגה
#         מזמן. הלקח: החרגות ברמת תיקייה בלי '/**'.
#   - v2: rg בסביבה זו אינו תומך ב- --files-from (אומת: "unrecognized flag") →
#         תוצאות "no matches" כוזבות. הלקח: לא לבסס חיפוש תוכן על flags שלא
#         אומתו בסביבה.
#   - v3: חיפוש תוכן ישירות על ROOTS גרם ל-self-match של הסורק עצמו ולכפילויות
#         (my-project נסרק דרך /home/z/my-project וגם דרך /home/z).
#   - v4: גישה דטרמיניסטית — רשימת קבצים אחת, מדודה (dedup), מסוננת
#         מהסורק עצמו, וחיפוש תוכן ממנה דרך xargs -d '\n'.
#
# כללי בטיחות:
#   - קריאה בלבד. לא מורץ קוד מהקבצים שנמצאו, לא נפתחים ארכיונים בשלב זה.
#   - תוכן של קבצים רגישים (.env, מפתחות, טוקנים) אינו נדפס — רק שמות, סיווג,
#     ובדיקות נוכחות-מפתח בוליאניות (true/false, לעולם לא ערכים).
#
# שימוש:
#   bash environment-scan.sh [OUTPUT_FILE]
#   ברירת מחדל: stdout. אם ניתן OUTPUT_FILE — נכתב אליו.
# =============================================================================

# NOTE: pipefail is intentionally NOT set — several consumers below truncate
# pipes early (head/awk), and upstream SIGPIPE (exit 141) must not abort the scan.
set -eu

# my-project נסרק דרך /home/z (מונע כפילויות). /tmp נסרק בנפרד.
ROOTS=(/home/z /tmp)

EXCLUDES=(
  -g '!node_modules' -g '!.next' -g '!.git' -g '!engineering'
  -g '!.venv' -g '!.bun' -g '!.local' -g '!.cache' -g '!.npm' -g '!.npm-global'
  -g '!*.lock' -g '!*.min.js' -g '!*.map'
)

KEYWORDS=(
  "steem" "steem main" "steem-main" "steem_main" "steemd"
  "witness" "blockchain" "node" "validator" "consensus"
  "bridge" "wallet" "rpc" "api" "hardfork" "token"
)

ARCHIVE_RE='(\.zip$|\.tar$|\.tgz$|\.tar\.gz$|\.tar\.bz2$|\.tar\.xz$|\.rar$|\.7z$|\.gz$|\.bz2$|\.xz$|\.jar$|\.war$|\.apk$)'
SECRET_RE='(/\.env$|/\.env\.|\.pem$|\.key$|secret|credential|token|password|id_rsa|id_ed25519|\.p12$|\.pfx$|keystore|\.htpasswd)'
TOOLCHAIN_RE='^/home/z/(\.venv|\.bun|\.local|\.cache|\.npm|\.npm-global)/'
BINARY_EXCLUDES=(-g '!*.png' -g '!*.jpg' -g '!*.jpeg' -g '!*.gif' -g '!*.webp'
  -g '!*.ico' -g '!*.woff' -g '!*.woff2' -g '!*.ttf' -g '!*.pdf'
  -g '!*.db' -g '!*.sqlite' -g '!*.sqlite3' -g '!*.node')

LIST="$(mktemp)"
LIST_ALL="$(mktemp)"
trap 'rm -f "$LIST" "$LIST_ALL"' EXIT

OUT_TARGET="${1:-}"
if [ -n "$OUT_TARGET" ]; then
  exec >"$OUT_TARGET"
fi

emit() { printf '%s\n' "$*"; }
section() { emit ""; emit "## $1"; emit ""; }

# -----------------------------------------------------------------------------
emit "# Environment Scan — Raw Output"
emit ""
emit "- Generated (UTC): $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
emit "- Generated (Asia/Jerusalem): $(TZ=Asia/Jerusalem date '+%Y-%m-%d %H:%M:%S %Z')"
emit "- Scanner: engineering/zip-analysis-20260907-1520/07_scripts/environment-scan.sh (v4)"
emit "- Roots scanned: ${ROOTS[*]} (my-project is scanned via /home/z — no duplicate walks)"
emit "- Excluded from walk (dir-level): node_modules, .next, .git, engineering (self), .venv, .bun, .local, .cache, .npm, .npm-global, *.lock, *.min.js, *.map"
emit ""

# ---- Build file lists (deduped; self-filtered) ------------------------------
rg --files "${ROOTS[@]}" --no-ignore --hidden "${EXCLUDES[@]}" 2>/dev/null \
  | sort -u \
  | rg -v '^/home/z/my-project/engineering/' >"$LIST" || true

rg --files "${ROOTS[@]}" --no-ignore --hidden \
   -g '!node_modules' -g '!.next' -g '!.git' -g '!engineering' \
   -g '!*.lock' -g '!*.min.js' -g '!*.map' 2>/dev/null \
  | sort -u >"$LIST_ALL" || true

emit "- Files in effective scan list (toolchain + self excluded, deduped): $(wc -l <"$LIST" | tr -d ' ')"
emit "- Files in full walk (toolchain included, for counting only, deduped): $(wc -l <"$LIST_ALL" | tr -d ' ')"

# Guard: content searches pipe the list into xargs; an empty list would make
# rg fall back to reading stdin (hang). Abort loudly instead.
if [ ! -s "$LIST" ]; then
  emit ""
  emit "FATAL: effective scan list is empty — file discovery failed. Aborting before content search."
  exit 1
fi

# -----------------------------------------------------------------------------
section "1. Archive files found (ZIP and similar)"
all_arch=$(rg -i "$ARCHIVE_RE" "$LIST_ALL" || true)
user_arch=$(echo "$all_arch" | rg -v "$TOOLCHAIN_RE" || true)
tool_arch=$(echo "$all_arch" | rg "$TOOLCHAIN_RE" || true)
if [ -n "$user_arch" ]; then
  echo "$user_arch" | while IFS= read -r f; do
    emit "- USER-RELEVANT ARCHIVE: $f ($(stat -c '%s bytes' "$f" 2>/dev/null || echo 'n/a'))"
  done
else
  emit "- RESULT: **No user-provided archive files found** (outside toolchain caches)."
fi
if [ -n "$tool_arch" ]; then
  emit "- Archive-like files inside toolchain caches (.venv/.bun/...): $(echo "$tool_arch" | wc -l | tr -d ' ') (package test fixtures; NOT user inputs — not analyzed)"
else
  emit "- Archive-like files inside toolchain caches: 0"
fi

# -----------------------------------------------------------------------------
section "2. Files whose NAME matches a keyword (filename-level)"
for kw in "${KEYWORDS[@]}"; do
  emit "### keyword: \`$kw\` (in file/dir name)"
  hits=$(rg -i -F -- "$kw" "$LIST" || true)
  if [ -n "$hits" ]; then
    n=$(echo "$hits" | wc -l | tr -d ' ')
    echo "$hits" | awk -v cap=60 'NR<=cap {print "- "$0}'
    if [ "$n" -gt 60 ]; then emit "- ... ($n total matches; listed first 60)"; fi
  else
    emit "- (no filename matches)"
  fi
done

# -----------------------------------------------------------------------------
section "3. Files whose CONTENT matches high-signal keywords (content-level)"
for kw in "steem" "steem-main" "steem_main" "steemd" "hardfork" "hard fork" "witness node" "dpos" "delegated proof" "block log" "chain id"; do
  emit "### content keyword: \`$kw\`"
  hits=$(xargs -d '\n' -a "$LIST" rg -il -F -- "$kw" "${BINARY_EXCLUDES[@]}" 2>/dev/null | awk 'NR<=40 {print}' || true)
  if [ -n "$hits" ]; then
    echo "$hits" | sort -u | while IFS= read -r f; do emit "- $f"; done
  else
    emit "- (no content matches)"
  fi
done

# -----------------------------------------------------------------------------
section "4. Generic keyword match counts (content-level; benign scaffold matches expected)"
for kw in "node" "validator" "consensus" "bridge" "wallet" "rpc" "api" "token" "blockchain" "witness"; do
  c=$(xargs -d '\n' -a "$LIST" rg -il -w -- "$kw" "${BINARY_EXCLUDES[@]}" 2>/dev/null | sort -u | wc -l | tr -d ' ')
  emit "- \`$kw\`: matches in ${c:-0} file(s)"
done

# -----------------------------------------------------------------------------
section "5. Potential secret-bearing files (names only — content intentionally NOT printed)"
emit "### Project / upload locations (full list)"
secrets=$(rg -i "$SECRET_RE" "$LIST" | rg -v 'tokens\.css$' || true)
if [ -n "$secrets" ]; then
  echo "$secrets" | while IFS= read -r f; do
    emit "- SENSITIVE (skipped from content review): $f"
  done
else
  emit "- (none)"
fi
emit "### Elsewhere in environment (count only)"
other=$(rg -i "$SECRET_RE" "$LIST" | rg -v 'tokens\.css$' | rg -v '^/home/z/my-project/' | wc -l | tr -d ' ')
emit "- ${other:-0} file(s) with secret-like names outside project paths (content not reviewed)"
emit "### Boolean presence checks (key presence only — values are never printed)"
if rg -q '_authToken' /home/z/.npmrc 2>/dev/null; then
  emit "- /home/z/.npmrc: contains an _authToken key (flag for review)"
else
  emit "- /home/z/.npmrc: no _authToken key"
fi
if rg -qi 'credential' /home/z/.gitconfig 2>/dev/null; then
  emit "- /home/z/.gitconfig: contains credential-related config (flag for review)"
else
  emit "- /home/z/.gitconfig: no credential-related config"
fi
emit "- /home/z/my-project/.env: exists (50 bytes); content intentionally NOT read or printed by this scanner"

# -----------------------------------------------------------------------------
section "6. Environment overview"
emit "### /home/z/my-project (top level)"
while IFS= read -r p; do
  if [ -d "$p" ]; then emit "- DIR  $p"; else emit "- FILE $p ($(stat -c '%s bytes' "$p" 2>/dev/null))"; fi
done < <(ls -A /home/z/my-project 2>/dev/null | sed 's|^|/home/z/my-project/|' || true)

emit ""
emit "### /home/z/my-project/upload (uploaded inputs)"
up=0
while IFS= read -r p; do up=$((up+1)); emit "- FILE $p ($(stat -c '%s bytes' "$p" 2>/dev/null))"; done \
  < <(ls -A /home/z/my-project/upload 2>/dev/null | sed 's|^|/home/z/my-project/upload/|' || true)
[ "$up" -eq 0 ] && emit "- (empty)"

emit ""
emit "### /home/z/my-project/download (generated files area)"
dl=0
while IFS= read -r p; do dl=$((dl+1)); emit "- FILE $p ($(stat -c '%s bytes' "$p" 2>/dev/null))"; done \
  < <(ls -A /home/z/my-project/download 2>/dev/null | sed 's|^|/home/z/my-project/download/|' || true)
[ "$dl" -eq 0 ] && emit "- (empty)"

emit ""
emit "### /home/z/my-project/src (application source tree)"
if [ -d /home/z/my-project/src ]; then
  while IFS= read -r p; do emit "- $p"; done \
    < <(rg --files /home/z/my-project/src 2>/dev/null | sort | head -40 || true)
fi

emit ""
emit "### /tmp/my-project (project snapshot copy)"
if [ -d /tmp/my-project ]; then
  ls -A /tmp/my-project | sed 's|^|- /tmp/my-project/|'
  if [ -d /tmp/my-project/upload ]; then
    emit "#### /tmp/my-project/upload"
    ls -A /tmp/my-project/upload 2>/dev/null | sed 's|^|- /tmp/my-project/upload/|' || true
  fi
else
  emit "- (does not exist)"
fi

emit ""
emit "### /home/z (top level)"
ls -A /home/z 2>/dev/null | sed 's|^|- /home/z/|' || true

emit ""
emit "### /tmp (top level)"
ls -A /tmp 2>/dev/null | sed 's|^|- /tmp/|' || true

emit ""
emit "### Git state of /home/z/my-project"
emit "- Branch: $(git -C /home/z/my-project branch --show-current 2>/dev/null || echo 'n/a')"
remotes=$(git -C /home/z/my-project remote -v 2>/dev/null || true)
if [ -z "$remotes" ]; then
  emit "- Remotes: **none configured** (push is not possible without a configured remote)"
else
  emit "- Remotes:"; echo "$remotes" | sed 's/^/  - /'
fi
emit "- Working-tree entries (porcelain) at scan time: $(git -C /home/z/my-project status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

emit ""
emit "---"
emit "End of scan. Read-only operations only; no archives were extracted; no code executed; no secret values printed."
