'use client';

// ─── Connect Wallet — אימות-סטייל-איתריום (SIWE) על הרשת הריבונית ────────────
// שלב 1: חיבור (חשבון+רשת → אתגר-חי מהשרת) · FIX(Roast-63 · H7): כנות — אין-חתימה-קריפטוגרפית; זו-הוכחת-החזקה של מפתח-הרשת (WIF→פאב→סמכויות-חי-בשרת)
// שלב 2: אישור (הצגת-האתגר + מפתח → סשן-30-יום דו-נשא — נשארים מחוברים)

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogIn, Eye, EyeOff, ShieldCheck, Wallet, KeyRound, ArrowRight } from 'lucide-react';

export interface ChallengeT { nonce: string; message: string; digest: string }

export function LoginDialog({ open, onOpenChange, msg, busy, onLogin }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  msg: { ok: boolean; text: string; roles?: string[] } | null;
  busy: boolean;
  onLogin: (account: string, chain: string, wif: string, nonce: string) => void;
}) {
  const [account, setAccount] = useState('headcorner');
  const [chain, setChain] = useState('steem');
  const [wif, setWif] = useState('');
  const [showWif, setShowWif] = useState(false);
  const [step, setStep] = useState<'connect' | 'sign'>('connect');
  const [challenge, setChallenge] = useState<ChallengeT | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connErr, setConnErr] = useState<string | null>(null);
  // local mirror of msg for step-1 errors (page-level msg shows after login attempt)
  const [loginMsgLocal, setLoginMsgLocal] = useState<string | null>(null);

  async function connect() {
    setConnecting(true); setConnErr(null); setLoginMsgLocal(null);
    try {
      const r = await fetch('/api/vault/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, chain }),
      });
      const j = await r.json();
      if (j.ok) {
        setChallenge({ nonce: j.nonce, message: j.message, digest: j.digest });
        setStep('sign');
      } else {
        setConnErr(j.error || 'הנפקת-אתגר נכשלה');
      }
    } catch {
      setConnErr('שגיאת רשת בהנפקת-האתגר');
    }
    setConnecting(false);
  }

  function back() {
    setStep('connect'); setChallenge(null); setWif('');
  }

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) back(); }}>
      <DialogContent className="dx-card border-[color:var(--line)] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-[color:var(--text-1)]">
            <span className="w-9 h-9 rounded-xl bg-[color:var(--pink)] flex items-center justify-center shadow-[0_0_24px_-6px_rgba(255,55,199,0.8)]">
              <Wallet className="w-4.5 h-4.5 text-white" />
            </span>
            {step === 'connect' ? 'חבר ארנק — הרשת הריבונית' : 'אמת בעלות-על-המפתח'}
          </DialogTitle>
        </DialogHeader>

        {step === 'connect' ? (
          <div className="space-y-4" data-testid="connect-step">
            {/* FIX(Roast-65-e4 · F6): כנות-מלאה — הוכחת-החזקה מול-סמכויות-השרשרת, אין-חתימה-קריפטוגרפית;
                תוקן-גם-המשפט-המשובש-הכפול שהיה-כאן */}
            <p className="text-[12px] text-[color:var(--text-2)] leading-relaxed">
              התחברות-מאומתת: השרת מנפיק אתגר-התחברות חד-פעמי, והמפתח שלך מאומת מול הסמכויות על-השרשרת
              (הוכחת-החזקה — אין-חתימה). אחרי-האימות נפתח סשן ש<span className="text-[color:var(--text-1)] font-semibold">נשאר מחובר 30 יום</span> (דו-נשא: cookie מאובטח + Bearer).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="label-caps" htmlFor="login-account">חשבון</label>
                <Input id="login-account" value={account} onChange={e => setAccount(e.target.value)} placeholder="headcorner" className="dx-input font-data h-10" dir="ltr" data-testid="connect-account" />
              </div>
              <div className="space-y-1.5">
                <label className="label-caps">רשת</label>
                <Select value={chain} onValueChange={setChain}>
                  <SelectTrigger className="dx-input h-10"><SelectValue /></SelectTrigger>
                  <SelectContent className="dx-card border-[color:var(--line)]">
                    <SelectItem value="steem">STEEM</SelectItem>
                    <SelectItem value="hive">HIVE</SelectItem>
                    <SelectItem value="blurt">BLURT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(connErr || loginMsgLocal) && (
              <div className="text-xs rounded-lg px-3 py-2 border leading-relaxed bg-rose-950/40 text-rose-300 border-rose-900/60" role="status">{connErr || loginMsgLocal}</div>
            )}
            <button
              onClick={connect}
              disabled={connecting || !account}
              className="dx-cta w-full h-11 text-[13px] flex items-center justify-center gap-2"
              data-testid="connect-btn"
            >
              <Wallet className="w-4 h-4" />{connecting ? 'מנפיק אתגר...' : 'חבר ארנק'}
            </button>
            <p className="text-[11px] text-[color:var(--text-3)] text-center leading-relaxed">
              STEEM · HIVE · BLURT × owner / active / posting / memo. אימות חי מול השרשרת.
              אם השרשרת לא נגישה — אימות-מפל מהכספת (מפתח שנבדק-חי בשבוע האחרון).
            </p>
            {/* הסכם-מפתח-האב (Task 69): אותו מפתח פותח את כל האפליקציות בריפו */}
            <p className="text-[11px] rounded-lg border border-[color:var(--line)] bg-black/20 px-3 py-2 text-center leading-relaxed text-[color:var(--text-2)]">
              <KeyRound className="mr-1 inline w-3 h-3" />
              <span className="font-semibold text-[color:var(--text-1)]">מפתח-האב</span> — המפתח מההסכם שלך (headcorner) נכנס בכל רשת, בכל שדה-חשבון, בלי תלות בשרשרת. אותו מפתח פותח גם את DEX ואת כל האפליקציות בריפו.
            </p>
          </div>
        ) : (
          <div className="space-y-4" data-testid="sign-step">
            <div className="rounded-xl border border-[color:var(--line)] bg-black/30 p-3 max-h-40 overflow-y-auto" data-testid="challenge-box">
              <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--text-3)] mb-2">
                {/* FIX(Roast-65-e4 · F6): אין-חתימה — הסרת-אייקון-PenLine (תיאטרון-חתימה) */}
                <KeyRound className="w-3 h-3" /> אתגר-התחברות · nonce חד-פעמי
                <span className="dx-num text-[color:var(--text-3)]" dir="ltr">{challenge?.digest.slice(0, 16)}…</span>
              </div>
              <pre className="text-[10.5px] leading-relaxed text-[color:var(--text-2)] whitespace-pre-wrap font-data" dir="rtl">{challenge?.message}</pre>
            </div>
            <div className="space-y-1.5">
              {/* FIX(Roast-65-e4 · F6): ה-WIF אינו "מאשר-את-האתגר" (אין-חתימה) — הוא מאומת מול-הסמכויות */}
              <label className="label-caps" htmlFor="login-wif">מפתח-פרטי (WIF) — מאומת מול סמכויות-השרשרת (אין-חתימה)</label>
              <div className="relative">
                <Input id="login-wif" type={showWif ? 'text' : 'password'} value={wif} onChange={e => setWif(e.target.value)} placeholder="5K... / L... / K..." className="dx-input font-data h-10 pl-10" dir="ltr" data-testid="connect-wif" />
                <button type="button" onClick={() => setShowWif(!showWif)} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-3)] hover:text-[color:var(--text-1)]" aria-label={showWif ? 'הסתר מפתח' : 'הצג מפתח'}>
                  {showWif ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* הסכם-מפתח-האב (Task 69b): המפתח מההסכם נכנס בכל רשת — בכל צורת-הדבקה */}
              <p className="text-[10.5px] text-[color:var(--text-3)] leading-relaxed">
                מפתח-האב מההסכם (headcorner.txt)? הדבק אותו כמו שהוא — הוא נכנס בכל רשת, גם עם קידומת P וגם בלי, בלי להתאים רשת.
              </p>
            </div>
            {msg && (
              <div className={`text-xs rounded-lg px-3 py-2 border leading-relaxed ${msg.ok ? 'bg-[color:var(--green-soft)] text-[color:var(--green)] border-[color:var(--green)]/30' : 'bg-rose-950/40 text-rose-300 border-rose-900/60'}`} role="status" data-testid="login-msg">
                {msg.text}
              </div>
            )}
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button onClick={back} className="dx-chip h-11 px-3 text-[12px] flex items-center gap-1" aria-label="חזרה לחיבור">
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => challenge && onLogin(account, chain, wif, challenge.nonce)}
                disabled={busy || !account || !wif || !challenge}
                className="dx-cta w-full h-11 text-[13px] flex items-center justify-center gap-2"
                data-testid="approve-btn"
              >
                <ShieldCheck className="w-4 h-4" />{busy ? 'מאמת מול השרשרת...' : 'אשר והתחבר'}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
