"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, RefreshCw, Smartphone, Trash2, Unplug } from "lucide-react";
import {
  apiJson, getDeviceId, getDeviceToken, GlowCard, rise, SectionHead, setDeviceToken,
} from "@/components/console/kit";
import type { DeviceRow } from "@/components/console/types";

export function TrustedDevices() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; devices: DeviceRow[]; liveCount?: number; expiringSoon?: number; cap?: number }>("/api/gate/device");
    if (r?.ok) setDevices(r.devices || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    setCurrentId(getDeviceId());
    void Promise.resolve().then(load);
  }, [load]);

  async function revoke(id: string) {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string; sessionsKilled?: number }>(`/api/gate/device?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r?.ok) {
        if (currentId === id) { setDeviceToken(null); setCurrentId(null); }
        toast.success(`המכשיר נשלל — הצופן נמחק מה-DB${r.sessionsKilled ? ` · ${r.sessionsKilled} סשנים שנפתחו דרכו נסגרו` : ""}`);
        await load();
      } else toast.error(r?.error || "השלילה נכשלה");
    } finally { setBusy(false); }
  }

  async function forgetThis() {
    setBusy(true);
    try {
      const dt = getDeviceToken();
      if (dt) {
        await fetch("/api/gate/device/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceToken: dt }) });
      }
      setDeviceToken(null);
      setCurrentId(null);
      toast("המכשיר הזה נשכח והצופן נמחק מה-DB — הכניסה הבאה במפתח-חי");
      await load();
    } finally { setBusy(false); }
  }

  async function revokeAll() {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string; revoked?: number; sessionsKilled?: number }>("/api/gate/device?all=1", { method: "DELETE" });
      if (r?.ok) {
        setDeviceToken(null);
        setCurrentId(null);
        toast.success(`כל מכשירי-הזכירה נשללו (${r.revoked ?? 0}) — הצופנים נמחקו מה-DB${r.sessionsKilled ? ` · ${r.sessionsKilled} סשנים נסגרו` : ""} · כניסת-מכשיר חסומה (שער-האופרטור נשאר לפי מדיניותו)`);
        await load();
      } else toast.error(r?.error || "השלילה נכשלה");
    } finally { setBusy(false); }
  }

  // ROAST r9 gap-34 — the renewal path: rotating the CURRENT device in place
  // (same row, new token, fresh 90 days) instead of waiting for silent death.
  async function rearmCurrent() {
    setBusy(true);
    try {
      const dt = getDeviceToken();
      if (!dt) { toast.error("אין טוקן-מכשיר בדפדפן הזה — אין מה לחדש"); return; }
      const r = await apiJson<{ ok: boolean; device?: { id: string; label: string }; deviceToken?: string; error?: string }>("/api/gate/device", {
        method: "POST", body: JSON.stringify({ deviceToken: dt }),
      });
      if (r?.ok && r.deviceToken && r.device) {
        setDeviceToken(r.deviceToken, r.device.id);
        setCurrentId(r.device.id);
        toast.success("המכשיר חודש ברוטציה — טוקן חדש, תוקף עוד 90 יום");
        await load();
      } else toast.error(r?.error || "החידוש נכשל");
    } finally { setBusy(false); }
  }

  // ROAST r9 gap-30 — "פעילים" finally means LIVE: not revoked, not expired,
  // ciphertext still in place. Expired rows are shown as what they are.
  const active = devices.filter((d) => d.live);
  const currentRow = devices.find((d) => d.id === currentId);
  const canRearm = Boolean(currentRow?.live && currentRow.expiringSoon && getDeviceToken());

  return (
    <section className="py-14">
      <SectionHead num="09" title="מכשירים-מהימנים" sub="זכירה-בטוחה של המפעיל: הטוקן חי בדפדפן בלבד, השרת מחזיק hash + מפתח-אב חתום תחתו. ה-DB לבדו אינו מסוגל להיכנס. הלב גורע פגי-תוקף ומתריע לפני פקיעה." />
      <motion.div {...rise}>
        <GlowCard className="p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h3 className="font-bold flex items-center gap-2"><Smartphone className="h-4 w-4 text-emerald-400" /> {active.length} מכשירים פעילים {devices.some((d) => !d.revoked && !d.live) && <span className="text-[10px] text-amber-400/80 font-normal">(+ פגי-תוקף שייגרעו)</span>}</h3>
            <div className="flex gap-2">
              {canRearm && (
                <Button variant="outline" size="sm" disabled={busy} onClick={rearmCurrent} className="h-8 text-[11px] gap-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                  <RefreshCw className="h-3 w-3" /> חמש מכשיר זה מחדש
                </Button>
              )}
              {currentId && (
                <Button variant="outline" size="sm" disabled={busy} onClick={forgetThis} className="h-8 text-[11px] gap-1 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60">
                  <Unplug className="h-3 w-3" /> שכח מכשיר זה
                </Button>
              )}
              {active.length > 0 && (
                <Button variant="outline" size="sm" disabled={busy} onClick={revokeAll} className="h-8 text-[11px] gap-1 border-rose-500/40 text-rose-300 hover:bg-rose-500/10">
                  <Trash2 className="h-3 w-3" /> שלול הכול
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto scroll-thin">
            {loading && <div className="flex items-center gap-2 text-sm text-zinc-500 py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>}
            {!loading && devices.map((d) => (
              <div key={d.id} className={"rounded-xl border px-3.5 py-3 flex items-center gap-3 flex-wrap " + (d.revoked || !d.live ? "border-zinc-800/60 bg-black/20 opacity-60" : "border-zinc-800/80 bg-black/40")}>
                <Smartphone className={"h-4 w-4 shrink-0 " + (d.revoked || !d.live ? "text-zinc-600" : "text-emerald-400")} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-zinc-200 flex items-center gap-2 flex-wrap">
                    {d.label}
                    {d.id === currentId && <Badge variant="outline" className="text-[9px] text-emerald-300 border-emerald-500/40">המכשיר הזה</Badge>}
                    {d.revoked && <Badge variant="outline" className="text-[9px] text-zinc-500 border-zinc-700">נשלל · צופן נמחק</Badge>}
                    {!d.revoked && !d.live && <Badge variant="outline" className="text-[9px] text-amber-300 border-amber-500/40">פג-תוקף — ייגרע עם הצופן</Badge>}
                    {!d.revoked && d.live && d.expiringSoon && <Badge variant="outline" className="text-[9px] text-amber-300 border-amber-500/40">יפוג בעוד {d.daysLeft} יום</Badge>}
                  </p>
                  <p className="text-[10px] text-zinc-600 font-mono">
                    נוצר {new Date(d.createdAt).toLocaleDateString("he-IL")} · שימוש אחרון {new Date(d.lastUsedAt).toLocaleString("he-IL")} · פג-תוקף {new Date(d.expiresAt).toLocaleDateString("he-IL")}
                  </p>
                </div>
                {!d.revoked && d.live && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400/80 shrink-0 mr-auto" title="שלילת מכשיר (הצופן נמחק + סשנים שנפתחו דרכו נסגרים)" disabled={busy} onClick={() => revoke(d.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {!loading && devices.length === 0 && (
              <p className="text-sm text-zinc-500 py-6 text-center">אין מכשירים-מהימנים — היכנס במפתח עם &quot;זכור אותי&quot; והמכשיר ייחרש כאן</p>
            )}
          </div>
          <p className="mt-4 text-[11px] text-zinc-600 leading-relaxed">
            איך זה בטוח: טוקן-המכשיר (256 סיביות) נולד בהתחברות וחי רק בדפדפן הזה · השרת מחזיק את ה-hash שלו בלבד, ואת מפתח-האב חתום תחת scrypt(טוקן) —
            כלומר גם גניבת-DB מלאה לא מאפשרת כניסה ולא פותחת את הכספת · שלילה מוחקת את הצופן עצמו מה-DB (לא רק דגל) וסוגרת את הסשנים שהמכשיר פתח —
            חוץ מהסשן שלך כאן · תוקף 90 יום, ניתן לחידוש ברוטציה, והלב מתריע 7 ימים לפני פקיעה · השער-האוטומטי של האופרטור (מדיניות "זה רק אני ואתה") הוא מישור נפרד ומתועד.
          </p>
        </GlowCard>
      </motion.div>
    </section>
  );
}
