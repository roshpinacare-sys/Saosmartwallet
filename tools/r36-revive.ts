/** r36 — revive the dev server via the PROVEN r7 double-fork spawn (survives tool-call boundaries). */
const { spawn } = await import("node:child_process");
const up = async (): Promise<boolean> => {
  try { const r = await fetch("http://localhost:3000/", { signal: AbortSignal.timeout(6000) }); return r.status === 200; }
  catch { return false; }
};
if (await up()) { console.log("server: already up"); process.exit(0); }
console.log("server: down — spawning via double-fork…");
const proc = spawn("bun", ["run", "dev"], { cwd: "/home/z/my-project", stdio: "ignore", detached: true });
proc.unref();
for (let i = 0; i < 14; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  if (await up()) { console.log(`server: up after ${(i + 1) * 5}s (pid ${proc.pid})`); process.exit(0); }
}
throw new Error("server did not come up in 70s");
