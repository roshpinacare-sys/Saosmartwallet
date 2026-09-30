/**
 * Single GitHub token resolver for the whole app — aligned with GitGate
 * (the machine's central git-auth store; see gitgate/README.md).
 *
 * Resolution order:
 *   1. env GITHUB_TOKEN            (portability / CI)
 *   2. ~/.gitgate/secrets/github.token   (THE single source of truth —
 *      what `gitgate set-token` writes; rotation propagates automatically
 *      on the next call, no restart, no copy in the repo)
 *   3. legacy upload/Roshcaregt.txt      (recovery flows only)
 *
 * The token never leaves this module's boundary except into an Authorization
 * header. It is never logged and never embedded in URLs.
 */
import { readFile } from "fs/promises";
import path from "path";

export async function githubToken(): Promise<string | null> {
  const env = process.env.GITHUB_TOKEN;
  if (env && env.trim().length > 10) return env.trim();

  try {
    const raw = await readFile(
      path.join(process.env.HOME || "/home/z", ".gitgate", "secrets", "github.token"),
      "utf8",
    );
    const token = raw.trim();
    if (token.length > 10) return token;
  } catch {
    /* store not present in this environment */
  }

  // Task 13-c: the LIVE operator-staged PAT (upload/pat.env — bare token,
  // R18/R19 format-tolerant) before the legacy Roshcaregt.txt fallback.
  for (const p of [
    path.join(process.cwd(), "upload", "pat.env"),
    "/home/z/my-project/upload/pat.env",
    path.join(process.cwd(), "upload", "Roshcaregt.txt"),
  ]) {
    try {
      const raw = (await readFile(p, "utf8")).trim();
      const token = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 10 && !l.startsWith("#")) ?? "";
      const value = token.replace(/^[A-Za-z_][A-Za-z0-9_]*=/, "").replace(/^["']|["']$/g, "").trim();
      if (value.length > 10) return value;
    } catch {
      /* candidate not present */
    }
  }
  return null;
}
