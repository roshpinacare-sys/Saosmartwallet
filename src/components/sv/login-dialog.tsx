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
      <DialogContent className="bg-white border-[#e8e8e3] max-w-md rounded-2xl shadow-[0_24px_70px_-20px_rgba(24,24,27,0.35)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-900">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-b from-emerald-600 to-emerald-700 flex items-center justify-center shadow-[0_2px_8px_-2px_rgba(5,150,105,0.5)]">
              <ShieldCheck className="w-4.5 h-4.5 text-emerald-50" />
            </span>
            התחברות חכמה — כל מפתח, כל שרשרת
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="label-caps" htmlFor="login-account">חשבון</label>
              <Input id="login-account" value={account} onChange={e => setAccount(e.target.value)} placeholder="headcorner" className="bg-white border-[#e0e0da] font-data h-10" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <label className="label-caps">שרשרת</label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger className="bg-white border-[#e0e0da] h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white border-[#e8e8e3]">
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
              <Input id="login-wif" type={showWif ? 'text' : 'password'} value={wif} onChange={e => setWif(e.target.value)} placeholder="5K... / L... / K..." className="bg-white border-[#e0e0da] font-data h-10 pl-10" dir="ltr" />
              <button type="button" onClick={() => setShowWif(!showWif)} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700" aria-label={showWif ? 'הסתר מפתח' : 'הצג מפתח'}>
                {showWif ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {msg && (
            <div className={`text-xs rounded-lg px-3 py-2 border leading-relaxed ${msg.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`} role="status">
              {msg.text}
            </div>
          )}
          <button
            onClick={() => onLogin(account, chain, wif)}
            disabled={busy || !account || !wif}
            className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[13px] font-bold shadow-[0_4px_16px_-4px_rgba(5,150,105,0.5)] transition-colors inline-flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />{busy ? 'מאמת מול השרשרת...' : 'התחבר ואמת'}
          </button>
          <p className="text-[11px] text-zinc-400 text-center leading-relaxed">
            STEEM · HIVE · BLURT × owner / active / posting / memo. המפתח נשמר מוצפן (AES-256-GCM) בכספת המקומית בלבד ומאומת חי מול השרשרת. אם השרשרת לא נגישה — אימות-מפל מהכספת (מפתח שנבדק-חי בשבוע האחרון).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
