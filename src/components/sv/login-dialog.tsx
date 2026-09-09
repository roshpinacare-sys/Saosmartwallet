'use client';

// ─── smart login — any key, any chain, vault-fallback when chain unreachable ──

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogIn, Eye, EyeOff, ShieldCheck } from 'lucide-react';

export function LoginDialog({ open, onOpenChange, msg, busy, onLogin }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  msg: { ok: boolean; text: string; roles?: string[] } | null;
  busy: boolean;
  onLogin: (account: string, chain: string, wif: string) => void;
}) {
  const [account, setAccount] = useState('headcorner');
  const [chain, setChain] = useState('steem');
  const [wif, setWif] = useState('');
  const [showWif, setShowWif] = useState(false);

  return (
    <Dialog open={open} onOpenChange={o => onOpenChange(o)}>
      <DialogContent className="bg-[#0f0f12] border-[#34343c] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="w-8 h-8 rounded-lg bg-[#0c0c0e] border border-[#34343c] flex items-center justify-center">
              <ShieldCheck className="w-4.5 h-4.5 text-[#d4a94e]" />
            </span>
            התחברות חכמה — כל מפתח, כל שרשרת
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="label-caps" htmlFor="login-account">חשבון</label>
              <Input id="login-account" value={account} onChange={e => setAccount(e.target.value)} placeholder="headcorner" className="bg-[#0c0c0e] border-[#26262c] font-data h-10" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <label className="label-caps">שרשרת</label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger className="bg-[#0c0c0e] border-[#26262c] h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#17171c] border-[#34343c]">
                  <SelectItem value="steem">STEEM</SelectItem>
                  <SelectItem value="hive">HIVE</SelectItem>
                  <SelectItem value="blurt">BLURT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="label-caps" htmlFor="login-wif">מפתח-פרטי (WIF)</label>
            <div className="relative">
              <Input id="login-wif" type={showWif ? 'text' : 'password'} value={wif} onChange={e => setWif(e.target.value)} placeholder="5K... / L... / K..." className="bg-[#0c0c0e] border-[#26262c] font-data h-10 pl-10" dir="ltr" />
              <button type="button" onClick={() => setShowWif(!showWif)} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300" aria-label={showWif ? 'הסתר מפתח' : 'הצג מפתח'}>
                {showWif ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {msg && (
            <div className={`text-xs rounded-lg px-3 py-2 border leading-relaxed ${msg.ok ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' : 'bg-red-500/10 text-red-300 border-red-500/25'}`} role="status">
              {msg.text}
            </div>
          )}
          <button
            onClick={() => onLogin(account, chain, wif)}
            disabled={busy || !account || !wif}
            className="w-full h-11 rounded-xl bg-gradient-to-b from-[#ecd28b] to-[#d4a94e] hover:from-[#f5e0a0] hover:to-[#dfb45a] disabled:opacity-40 disabled:hover:from-[#ecd28b] text-[#09090b] text-[13px] font-bold shadow-[0_0_24px_rgba(212,169,78,0.15)] transition-all inline-flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />{busy ? 'מאמת מול השרשרת...' : 'התחבר ואמת'}
          </button>
          <p className="text-[11px] text-zinc-600 text-center leading-relaxed">
            STEEM · HIVE · BLURT × owner / active / posting / memo. המפתח נשמר מוצפן (AES-256-GCM) בכספת המקומית בלבד ומאומת חי מול השרשרת. אם השרשרת לא נגישה — אימות-מפל מהכספת (מפתח שנבדק-חי בשבוע האחרון).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
