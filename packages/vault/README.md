# packages/vault — AES-256-GCM Encrypted Local Key Vault

**STATUS: task 4-b (swarm 1) — implemented, 53/53 selftests green, zero dependencies.**

The production key store for the Saosmartwallet HSM-signing runtime (owner
directive §3/§8): every key the sovereign wallet operates is sealed at rest
with envelope encryption, gated by a master key that exists ONLY as an
environment variable, and every failure mode fails closed.

This package composes audited OS primitives (`node:crypto` AES-256-GCM,
HKDF-SHA256, ed25519 via DER-wrapped KeyObjects) — it invents no cryptographic
math. Base58/WIF/PKCS#8 wrapping are implemented in-package, by hand, and
pinned to canonical known-answer vectors.

---

## Hard invariants (directive §11 — enforced by code AND tests)

1. **Zero plaintext keys.** Key material exists in memory only transiently
   (unseal → use → zero-fill) and in ciphertext on disk. It never appears at
   rest, in logs (the package logs nothing), in error messages (sentinel-scan
   tested over every error path), or in git (`state/` is gitignored).
2. **Master key from env only.** `SAOS_VAULT_MASTER_KEY` must be exactly
   64 hex chars (32 bytes). It is never persisted, never echoed — not even
   fragments — and the env VALUE never enters an error message (length only).
3. **Envelope encryption.** Per-key random 12-byte IV + AES-256-GCM
   (authentication tag verified on every unseal).
4. **Fail-closed.** Missing/bad env, corrupt store, tampered ciphertext/tag,
   wrong master key, unknown id, duplicate id, bad material, oversized store —
   all throw `VaultError` with a stable code. No null-then-continue, no
   partial material, no fallback path anywhere.
5. **`secp256k1` here is storage/roundtrip/validation ONLY** (WIF encode/
   decode, scalar range checks). ECDSA signing for secp256k1 chains lives in
   `packages/crypto`/`packages/chains` — no third-party deps in this package.

## Threat model — what this protects, what it does not

**Protects against:**

- **At-rest theft** of the store file (disk image, accidental copy, backup
  leak): without the master key, AES-256-GCM auth prevents any decryption or
  undetected modification.
- **Git leakage**: `state/` is gitignored at the package root; the store is
  never committed (same class of failure as the historical saos-jummper
  `KEYS-ACCESS` archive — this gate exists precisely for that).
- **Silent corruption / tampering**: any single flipped byte in a ciphertext,
  auth tag, or the store verify block is detected (GCM) and fails closed.
- **Casual process-level key scraping of state files**: nothing plaintext is
  ever written; `keys.enc` is mode 0600, the state dir mode 0700.
- **Wrong-vault mistakes**: a store created under master key A cannot be
  opened with key B — even an empty store proves its master key at open.

**Does NOT protect against (honest limits):**

- **A compromised host / root**: the master key must be in the process env;
  anyone who can read that env (or the process memory) can open the vault.
  This is a software vault, not an HSM with a hardware trust boundary — the
  name "HSM signing runtime" describes the operational goal, not the silicon.
- **Memory forensics on a live process**: JS zeroization (`fill(0)`) is
  best-effort; the GC may have copied bytes before the wipe. Meaningful, not
  cryptographic.
- **A physically stolen running machine** with the env var persisted in a
  service file — that is an ops problem (use a secrets manager / tmpfs env).
- **Side channels, rowhammer, cold-boot attacks** — out of scope.

## Store format (`<dir>/keys.enc`, JSON, mode 0600)

```jsonc
{
  "version": 1,
  "store": {
    "salt": "<hex 32B — per-store, generated at creation>",
    "verify": { "iv": "...", "authTag": "...", "ciphertext": "..." }
    // GCM seal of the constant "saos-vault/verify/v1" — proves the master
    // key at openVault BEFORE any key envelope is touched (even empty store)
  },
  "keys": [
    {
      "id": "saos.tst/active",
      "type": "ed25519" | "secp256k1-wif" | "opaque",
      "salt": "<same per-store salt>",
      "iv": "<hex 12B — fresh random per key>",
      "authTag": "<hex 16B>",
      "ciphertext": "<hex — AES-256-GCM of the material>",
      "meta": { "account": "saos.tst", "role": "active" },
      "createdAt": "2026-10-24T18:00:00.000Z"
    }
  ]
}
```

- AES key = HKDF-SHA256(masterKey, salt, `"saos/vault/v1/verify" | "saos/vault/v1/key"`).
- All envelopes must agree on the store salt; mismatch ⇒ fail-closed.
- Writes are atomic (tmp file + rename), 0600, no temp leftovers.
- A stale writer MERGES on save (disk truth ∪ its own keys) instead of
  clobbering; a foreign salt on disk ⇒ `VAULT_E_STORE_CONFLICT`, and an
  unreadable disk store is never overwritten.
- Per-envelope isolation: a tampered envelope fails ITS unseal; healthy
  neighbor keys keep working. The verify block protects the whole store at
  open time.

## Key types

| type            | material at seal                                   | unsealed return              | notes |
|-----------------|----------------------------------------------------|------------------------------|-------|
| `ed25519`       | 32-byte seed Buffer, or 64-hex-char seed string    | 32-byte seed `Buffer`        | sign/verify via `node:crypto` with hand-rolled PKCS#8 DER wrapping (RFC 8410); all-zero seed rejected |
| `secp256k1-wif` | 32-byte scalar Buffer, or base58check WIF string   | 32-byte scalar `Buffer`      | WIF string input is WIF ONLY (hex goes in as Buffer) — inputs stay unambiguous; checksum + version + flag + range (0 < s < N) enforced |
| `opaque`        | arbitrary non-empty Buffer, or UTF-8 string        | byte `Buffer`                | for secrets like posting WIFs as strings; decrypt with `.toString("utf8")` |

## API

```ts
import { openVault, ed25519Verify, wifEncode, wifDecode, ed25519PublicKey } from "packages/vault/src/index";

// Master key comes from env — missing/bad hex fails closed before anything else.
const vault = await openVault({ dir: "./state" }); // default dir: packages/vault/state

// Seal (duplicate id ⇒ VAULT_E_DUPLICATE_ID; rotation is explicit by design)
const sealed = await vault.sealKey({
  id: "solana/main",
  type: "ed25519",
  material: seed32,              // Buffer or 64-hex string
  meta: { account: "saos.tst" }, // public metadata only
});
// sealed = { id, type, salt, iv, authTag, ciphertext, meta, createdAt } — NO material

// Unseal (caller owns the returned buffer)
const { type, material, meta } = await vault.unsealKey("solana/main");

// Scoped use with best-effort zeroization — preferred over unsealKey
const out = await vault.withKey("solana/main", async (k) => {
  // k.material is the seed; it is ZERO-FILLED after this callback settles
  // (resolved OR rejected) and must not be retained beyond the callback.
  return doSomethingWith(k.material);
});

// Signing — the seed is never exposed to the caller
const sig64 = await vault.signEd25519("solana/main", messageBuffer); // 64 bytes
const ok = ed25519Verify(pub32Raw, messageBuffer, sig64);            // pure function
const pub = await vault.ed25519PublicKey("solana/main");

// Metadata ONLY — never material, never envelope fields
const listing = vault.listKeys(); // [{ id, type, meta, createdAt }]
```

### Error taxonomy (`VaultError.code`)

| code | meaning |
|---|---|
| `VAULT_E_ENV_MISSING` | `SAOS_VAULT_MASTER_KEY` unset |
| `VAULT_E_ENV_INVALID` | env value not exactly 64 hex chars (value never echoed) |
| `VAULT_E_STORE_CORRUPT` | store unreadable / not JSON / schema deviation / oversized |
| `VAULT_E_STORE_CONFLICT` | on-disk store re-created under a different salt |
| `VAULT_E_AUTH` | GCM auth failure — wrong master key or tampered data |
| `VAULT_E_UNKNOWN_ID` | no key sealed under that id |
| `VAULT_E_DUPLICATE_ID` | id already sealed (no silent overwrite) |
| `VAULT_E_BAD_INPUT` | bad id / material shape / wrong key type / non-JSON meta |

## Safety gates (selftest `test/vault.test.ts` — 53 tests, 426 assertions)

- Master-key gate: missing, short, long, non-hex — value never echoed.
- Roundtrip: all three types, Buffer + string inputs, meta roundtrip,
  `SealedRecord` proven plaintext-free.
- Tamper: flipped byte in verify block ⇒ `openVault` rejects; flipped byte in
  a key envelope ⇒ that unseal rejects while neighbors survive; flipped auth
  tag; flipped salt.
- Wrong master key: rejected at `openVault` for empty AND populated stores.
- WIF: canonical compressed (`KwDiBf89…`) and uncompressed (`5HpHag…`) vectors
  for scalar 0x00..01 both directions; base58 alphabet edges; checksum,
  version, and flag-byte corruption fail closed.
- ed25519: RFC 8032 §7.1 TEST 1/2 known-answer through the vault signing
  path; wrong message/tampered sig/wrong pubkey verify false; malformed
  inputs return false (never throw).
- Zeroization: `withKey` wipes the material buffer on success and failure.
- Redaction: sentinel scan over EVERY error path (ASCII, hex, base64, WIF,
  master-key fragments) — zero hits; store file proven plaintext-free.
- Persistence: across `openVault` instances; stale-writer merge loses nothing.
- Hygiene: 0600/0700 modes, atomic writes leave no temp files, memory-bomb
  guard (16 MiB store cap), full schema-corruption matrix fails closed.

## Operations

- **Provision the master key**: generate 32 random bytes
  (`openssl rand -hex 32`), inject as `SAOS_VAULT_MASTER_KEY` via your secrets
  manager (never a committed file). Losing it means losing every key — there
  is no recovery path by design.
- **Rotate the master key**: create a new vault dir under a new key, unseal
  from the old vault and re-seal into the new one inside one trusted process,
  then destroy the old store. (A built-in rotate command is future work —
  this package ships the primitive, not the policy.)
- **Back up**: back up `keys.enc` (ciphertext) AND the master key separately;
  never co-located, never in git.
- **Run the selftests**: `bun test packages/vault` (from the repo root).
