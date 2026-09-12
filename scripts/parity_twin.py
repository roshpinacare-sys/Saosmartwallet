#!/usr/bin/env python3
"""
TWIN-PARITY engine (r29) — the Python twin of the gate's TS primitives.

Doctrine (from saos-sovereign-platform, repo roshpinacare-sys):
  "no engine evaluates itself" — the TS side computes vectors with its own
  code; this script RECOMPUTES the same vectors from the raw inputs with a
  fully independent implementation (stdlib only: hashlib + hand-rolled
  base58) and compares. Every mismatch is a finding, not a failure to hide.

Input  (stdin): JSON  { d1: [{account, role, seed, expected}],
                        wif: [{privHex, expected}],
                        digest: {counts, rows, expected} }
Output (stdout): JSON  { ok, families, mismatches, twin }

Determinism contract replicated here:
  · D1 privHex  = sha256(account + role + p5) as lowercase hex  (rotation.ts)
  · WIF         = base58check(0x80 || priv32)                   (rotation.ts)
  · digest      = sha256(JSON.stringify({protocol, counts, rows: sorted}))
    where the JSON string is the compact form ("," ":") and key order is the
    insertion order of the TS object (json.loads preserves it; json.dumps
    with separators=(',',':') emits the same bytes for ASCII payloads).

No secrets ever reach this script: seeds are day-keyed synthetic parity
vectors and rows are PUBLIC identity material (chain/account/role/pub).
"""

import hashlib
import json
import sys

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = []
    while n > 0:
        n, r = divmod(n, 58)
        out.append(ALPHABET[r])
    # leading zero bytes each become '1'
    for b in data:
        if b == 0:
            out.append(ALPHABET[0])
        else:
            break
    return "".join(reversed(out))


def b58check(version_byte: int, payload: bytes) -> str:
    full = bytes([version_byte]) + payload
    chk = hashlib.sha256(hashlib.sha256(full).digest()).digest()[:4]
    return b58encode(full + chk)


def d1_priv_hex(account: str, role: str, p5: str) -> str:
    return hashlib.sha256((account + role + p5).encode("utf-8")).hexdigest()


def digest_formula(counts: dict, rows: list) -> str:
    payload = json.dumps(
        {"protocol": "parity/v1", "counts": counts, "rows": rows},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main() -> None:
    req = json.load(sys.stdin)
    mismatches = []
    fam = {}

    d1 = req.get("d1") or []
    d1_ok = 0
    for v in d1:
        got = d1_priv_hex(str(v["account"]), str(v["role"]), str(v["seed"]))
        if got == str(v["expected"]):
            d1_ok += 1
        else:
            mismatches.append({"family": "d1", "input": [v["account"], v["role"], v["seed"]], "got": got[:16], "want": str(v["expected"])[:16]})
    fam["d1"] = {"n": len(d1), "ok": d1_ok}

    wif = req.get("wif") or []
    wif_ok = 0
    for v in wif:
        try:
            got = b58check(0x80, bytes.fromhex(str(v["privHex"])))
        except Exception as e:  # noqa: BLE001
            mismatches.append({"family": "wif", "error": str(e)})
            continue
        if got == str(v["expected"]):
            wif_ok += 1
        else:
            mismatches.append({"family": "wif", "got": got[:12], "want": str(v["expected"])[:12]})
    fam["wif"] = {"n": len(wif), "ok": wif_ok}

    dc = req.get("digest") or {}
    dig_ok = False
    dig_got = ""
    if dc:
        try:
            dig_got = digest_formula(dc["counts"], dc["rows"])
            dig_ok = dig_got == str(dc["expected"])
            if not dig_ok:
                mismatches.append({"family": "digest", "got": dig_got[:16], "want": str(dc["expected"])[:16]})
        except Exception as e:  # noqa: BLE001
            mismatches.append({"family": "digest", "error": str(e)})
    fam["digest"] = {"n": 1 if dc else 0, "ok": 1 if dig_ok else 0}

    total = fam["d1"]["n"] + fam["wif"]["n"] + fam["digest"]["n"]
    passed = fam["d1"]["ok"] + fam["wif"]["ok"] + fam["digest"]["ok"]
    print(json.dumps({
        "ok": len(mismatches) == 0,
        "total": total,
        "passed": passed,
        "families": fam,
        "mismatches": mismatches[:8],
        "twin": "python3-stdlib/parity-v1",
        "note": "independent reimplementation — hashlib + hand-rolled base58; no shared code with TS",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
