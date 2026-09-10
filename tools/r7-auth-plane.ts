/**
 * ROAST round 7 — the AUTHENTICATED plane (r6 explicitly left the full console
 * untested: "no session here — the right limit"). This tool mints a LOCAL
 * operator session WITHOUT any master key (createSession("operator") — no
 * encMaster), uses it to verify the authenticated console renders, then
 * REVOKES the session. No vault content is opened, no keys are touched —
 * this tests the identity layer r6 closed, from the inside.
 */
import crypto from "crypto";
import { db } from "../src/lib/db";
import { sha256hex, randomToken } from "../src/lib/gate/crypto";

const BASE = "http://localhost:3000";

async function main() {
  const token = randomToken(32);
  await db.gateSession.create({
    data: {
      tokenHash: sha256hex(token),
      kind: "operator",
      name: "operator",
      scopes: JSON.stringify(["*"]),
      encMaster: null,
      sealSalt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  console.log(`test session minted (no master) — token starts ${token.slice(0, 6)}…`);
  try {
    const H = { Cookie: `gate_session=${token}` };

    // 1. the authenticated console page
    const page = await fetch(`${BASE}/`, { headers: H });
    const html = await page.text();
    console.log(`console page: ${page.status} · ${html.length} chars`);
    const hebrewVisible = /נעילה|כספת|מודולים/.test(html);
    console.log(`console renders Hebrew chrome: ${hebrewVisible}`);

    // 2. key authenticated APIs respond (identity accepted, no master needed)
    for (const path of ["/api/gate/status", "/api/gate/modules", "/api/gate/messages"]) {
      const r = await fetch(`${BASE}${path}`, { headers: H });
      const body = (await r.text()).slice(0, 80);
      console.log(`auth ${path}: ${r.status} ${body.replace(/\n/g, " ")}`);
    }

    // 3. heart view (the operator's autonomy panel)
    const heart = await fetch(`${BASE}/api/gate/heart`, { headers: H });
    const hj = (await heart.json()) as { ok?: boolean; counts?: { queued?: number; running?: number }; constants?: { HEART_TICK_MS?: number } };
    console.log(`auth /heart: ${heart.status} ok=${hj.ok} queued=${hj.counts?.queued} running=${hj.counts?.running} tick=${hj.constants?.HEART_TICK_MS}`);

    // 4. vault-open endpoints must stay FAIL-CLOSED even for an operator session
    //    without a master (423 vault-locked is the honest answer)
    const reveal = await fetch(`${BASE}/api/gate/reveal`, { headers: H, method: "POST", body: JSON.stringify({ id: "x" }) });
    console.log(`auth /reveal (no master): ${reveal.status} (expect 400/423 — fail-closed)`);

    // 5. fuzz plane — malformed inputs on public+authed routes
    const fuzzes: Array<[string, string, string, number]> = [
      ["/api/gate/login", "POST", "{not-json", 400],
      ["/api/gate/login", "POST", JSON.stringify({ key: 5 }), 400],
      ["/api/gate/login", "POST", JSON.stringify({ key: "x".repeat(100000) }), 400],
      ["/api/gate/setup", "POST", JSON.stringify({ passphrase: "123" }), 400],
      ["/api/vault/backup", "POST", "{broken", 400],
      ["/api/gate/run", "POST", JSON.stringify({}), 401],
    ];
    for (const [path, method, body, expect] of fuzzes) {
      const r = await fetch(`${BASE}${path}`, { headers: H, method, body });
      console.log(`fuzz ${method} ${path} (${body.length}b): ${r.status} (expect ${expect}) ${r.status === expect ? "✓" : "⚠"}`);
    }

    // 6. r6 closures still hold?
    const lock = await fetch(`${BASE}/api/gate/lock`, { method: "POST", body: "{}" });
    console.log(`anon /gate/lock: ${lock.status} (r6 closure — expect 400/401)`);
    const devKeys = await fetch(`${BASE}/api/developer/keys`);
    console.log(`anon /developer/keys: ${devKeys.status} (r6 closure — expect 401)`);
    const devUsage = await fetch(`${BASE}/api/developer/usage`);
    console.log(`anon /developer/usage: ${devUsage.status} (r6 closure — expect 401)`);
  } finally {
    await db.gateSession.delete({ where: { tokenHash: sha256hex(token) } });
    console.log("test session revoked — clean.");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
