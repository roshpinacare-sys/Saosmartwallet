import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/* ══ SAOS-DEX bridge — השער המאובטח בין הקונסולה למנוע הבורסה ═══════════════
 * POST { action, payload } → http://127.0.0.1:3010/saos-dex/api/dex/<action>
 *
 * מודל-אבטחה:
 * · GET-ים של המנוע ציבוריים (הדפדפן קורא ישירות /saos-dex/api/dex/state —
 *   אותו-מקור דרך ה-rewrite של next.config).
 * · כל מוטציה עוברת דרך כאן: קודם requireOwner (סשן הכספת — Bearer/cookie),
 *   ואז השרת מצרף את DEX_OPERATOR_TOKEN + כותרת הקונסולה לפני ההעברה לדמון.
 * · הטוקן אף פעם לא יוצא לדפדפן — נשאר ב-.env של השרת בלבד.
 * · רשימת-פעולות סגורה (whitelist) — אי אפשר להגיע ל-reset דרך הקונסולה. */

const DEX_BASE = 'http://127.0.0.1:3010/saos-dex/api/dex';

const ALLOWED = new Set([
  'route',    // POST — ביצוע מסלול-ראוטר אטומי
  'swap',     // POST — סוואג' בריכת 30bps
  'order',    // POST — הזמנת-לימיט / מילוי-שוק על הספר
  'cancel',   // POST — ביטול הזמנת operator
  'pool',     // POST — add/remove נזילות
  'wrap',     // POST — עטיפה/פריקה 1:1
  'convert',  // POST — המרה דרך הסולם
  'transfer', // POST — העברה בין ארנקים
  'economy',  // POST — Task 54: ve_lock/ve_unlock/ve_vote/bond_buy (כלכלה-מטורפת)
  'program',  // POST — Task 56: מסחר-אוטומטי חסר-קיפרים (DCA + טריגרים stop/take)
  'launchpad', // POST — Task 57: מסילת-ההשקות (עקומה/LBP + קנייה/מכירה)
]);

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) {
    return NextResponse.json(
      { ok: false, error: 'auth-required', note: 'התחבר דרך התפריט כדי לבצע פעולות מסחר' },
      { status: 401 },
    );
  }

  const token = process.env.DEX_OPERATOR_TOKEN;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'bridge-unconfigured', note: 'הגשר למנוע אינו מוגדר בשרת' },
      { status: 503 },
    );
  }

  let body: { action?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 200 });
  }
  const action = String(body.action || '');
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ ok: false, error: 'action-not-allowed' }, { status: 200 });
  }

  try {
    const r = await fetch(`${DEX_BASE}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-saos-operator': token,
        'x-saos-dex-console': '1',
      },
      body: JSON.stringify(body.payload || {}),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({ ok: false, error: 'bad-engine-response' }));
    return NextResponse.json(j, { status: r.status === 503 ? 503 : 200 });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'engine-unreachable', note: 'מנוע הבורסה לא נגיש — נסה שוב בעוד רגע' },
      { status: 200 },
    );
  }
}
