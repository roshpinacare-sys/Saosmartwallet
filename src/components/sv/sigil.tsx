'use client';

// ─── the sovereign sigil — animated vault seal (light) ─────────────────────
// live → emerald heartbeat pulse · verifying → spin ring.

import { ShieldCheck, Loader2 } from 'lucide-react';

export function Sigil({ size = 'md', live = false, verifying = false }: { size?: 'sm' | 'md' | 'lg'; live?: boolean; verifying?: boolean }) {
  const dims = size === 'lg' ? 'w-14 h-14' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const icon = size === 'lg' ? 'w-7 h-7' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="relative shrink-0">
      {verifying && <span className="absolute -inset-1.5 rounded-2xl border-2 border-emerald-500/40 animate-pulse-brand" />}
      {live && !verifying && <span className="absolute -inset-1 rounded-2xl pulse-ring" />}
      <div className={`relative ${dims} rounded-xl bg-gradient-to-b from-emerald-600 to-emerald-700 flex items-center justify-center shadow-[0_2px_10px_-2px_rgba(5,150,105,0.5),inset_0_1px_0_rgba(255,255,255,0.25)]`}>
        {verifying
          ? <Loader2 className={`${icon} text-emerald-50 animate-spin`} />
          : <ShieldCheck className={`${icon} text-emerald-50`} strokeWidth={2.2} />}
      </div>
    </div>
  );
}
