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

  try {
    const raw = await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8");
    const token = raw.trim();
    return token.length > 10 ? token : null;
  } catch {
    return null;
  }
}
