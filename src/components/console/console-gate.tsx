"use client";

/**
 * ConsoleGate (r48) — the vault gate's loading surface.
 *
 * Live-proven problem: the console is a giant lazy chunk with NO persistent
 * build cache (.next/cache absent in this sandbox), so every dev-server
 * restart = a full cold compile and the operator stares at a frozen-looking
 * "טוען קונסולה…" spinner for minutes — with zero feedback and zero escape.
 * If the dynamic import itself ever rejects (transient 500 while a route
 * compiles, measured live on /api/gate/session), the fallback renders
 * forever: a dead-end.
 *
 * Fix: an honest loading state machine —
 *   · 0s     spinner + plain "טוען קונסולה…"
 *   · >8s    first-compile hint (the honest explanation)
 *   · >40s   refresh escape hatch (a real button — server may have restarted
 *            mid-compile; a reload re-requests the now-warm chunk)
 * Text stays Hebrew, monospace, emerald-on-black — same language contract
 * as the console around it.
 */

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export default function ConsoleGate() {
  const [since] = useState(() => Date.now());
  const [phase, setPhase] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase((p) => (p < 1 ? 1 : p)), 8_000);
    const t2 = setTimeout(() => setPhase((p) => (p < 2 ? 2 : p)), 40_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div
      className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-6 text-center"
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-5 w-5 animate-spin text-emerald-500" aria-hidden />
      <span className="font-mono text-xs text-zinc-500">טוען קונסולה…</span>
      {phase >= 1 && (
        <span className="font-mono text-[11px] text-zinc-600 max-w-sm leading-relaxed">
          הקומפילציה הראשונה אחרי הפעלת-השרת יכולה לקחת דקה-שתיים — הכספת
          נטענת ברקע ואין צורך לעשות דבר.
        </span>
      )}
      {phase >= 2 && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-1 inline-flex items-center gap-2 rounded-md border border-emerald-900 px-3 py-2 font-mono text-[11px] text-emerald-400 hover:bg-emerald-950/40 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          עדיין לא נטען? רענון
        </button>
      )}
    </div>
  );
}
