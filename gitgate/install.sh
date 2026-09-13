#!/usr/bin/env bash
# GitGate installer — run from ANY chat to (re)install the auth bridge.
# Usage:  bash /home/z/my-project/gitgate/install.sh
# Idempotent: safe to run any number of times. Never touches stored tokens.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GG="$HOME/.gitgate"

mkdir -p "$GG/bin" "$GG/secrets"
chmod 700 "$GG" "$GG/secrets" 2>/dev/null || true
install -m 700 "$HERE/bin/git-credential-gitgate" "$GG/bin/git-credential-gitgate"
install -m 700 "$HERE/bin/gitgate" "$GG/bin/gitgate"

git config --global credential.https://github.com.helper "$GG/bin/git-credential-gitgate"
git config --global --replace-all safe.directory '*'

if [ -r "$GG/secrets/github.token" ]; then
  echo "[gitgate] installed. token present (fingerprint $($GG/bin/gitgate fingerprint))."
else
  echo "[gitgate] installed. NO token yet — seed it with:"
  echo "          $GG/bin/gitgate set-token --from <token-file.txt>"
fi
echo "[gitgate] check health with: $GG/bin/gitgate doctor"
