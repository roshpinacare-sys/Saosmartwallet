'use client';

// ─── the sovereign sigil — animated vault seal ─────────────────────────────
// Concentric mechanical seal: gold sigil on a data-well disc.
// live → emerald heartbeat pulse · verifying → gold spin ring.

import { ShieldCheck, Loader2 } from 'lucide-react';

export function Sigil({ size = 'md', live = false, verifying = false }: { size?: 'sm' | 'md' | 'lg'; live?: boolean; verifying?: boolean }) {
  const dims = size === 'lg' ? 'w-14 h-14' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const icon = size === 'lg' ? 'w-7 h-7' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="relative shrink-0">
      {verifying && <span className="absolute -inset-1.5 rounded-2xl border border-[#d4a94e]/50 animate-pulse-gold" />}
      {live && !verifying && <span className="absolute -inset-1 rounded-2xl pulse-ring" />}
      <div className={`relative ${dims} rounded-xl bg-[#0c0c0e] border border-[#34343c] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_2px_8px_rgba(0,0,0,0.5)]`}>
        <span className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/[0.06] to-transparent" />
        {verifying
          ? <Loader2 className={`${icon} text-[#d4a94e] animate-spin`} />
          : <ShieldCheck className={`${icon} text-[#d4a94e]`} strokeWidth={2.2} />}
      </div>
    </div>
  );
}
