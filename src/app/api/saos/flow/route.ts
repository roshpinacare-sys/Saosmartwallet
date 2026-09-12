import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import { flowOverview } from '@/lib/saos/flow';
import { steemVote, hiveSavingsSweep, steemClaimRewards, curationCandidates, postInfo, getAccount, getGlobalProps, vestsToChainVests } from '@/lib/saos/steem-ops';
import { trxEnergize, tronAccount, treasuryWallet } from '@/lib/saos/trx-ops';

export const dynamic = 'force-dynamic';

/* ══ /api/saos/flow — מנוע-הזרימה הריבוני (Task 71-flow) ═════════════════════
 * GET  — תמונת-מצב אמת (אוצר + לולאות + פקדה) · קריאה-בלבד.
 * POST — פעולות: dry-run ברירת-מחדל; execute:true דורש-סשן-מפעיל (requireOwner)
 *        ונרשם-בביקורת + משודר-לריליי. אף-סוד לא נדפס/לא יוצא. */

export async function GET() {
  try {
    const o = await flowOverview();
    return NextResponse.json(o);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'flow failed' }, { status: 200 });
  }
}

async function dexRealmarket(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const token = process.env.DEX_OPERATOR_TOKEN;
  if (!token) return { status: 503, json: { ok: false, error: 'bridge-unconfigured' } };
  const r = await fetch('http://127.0.0.1:3010/saos-dex/api/dex/realmarket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-saos-operator': token, 'x-saos-dex-console': '1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const json = (await r.json().catch(() => ({ ok: false, error: 'bad-engine-response' }))) as Record<string, unknown>;
  return { status: r.status, json };
}

export async function POST(req: NextRequest) {
  let body: { action?: string; execute?: boolean; params?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 200 }); }
  const action = String(body.action ?? '');
  const execute = body.execute === true;
  const p = body.params ?? {};

  // autovote_pick הוא read-only — פתוח-בלי-סשן (בחירת-מועמד לתצוגה)
  if (action === 'autovote_pick') {
    try {
      const tag = typeof p.tag === 'string' ? p.tag : '';
      const cands = await curationCandidates(tag);
      return NextResponse.json({ ok: true, action, dryRun: true, candidates: cands.slice(0, 5) });
    } catch (e) {
      return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'pick failed' }, { status: 200 });
    }
  }

  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'auth-required', note: 'התחבר כמפעיל כדי להריץ פעולות-זרימה' }, { status: 401 });

  try {
    switch (action) {
      /* ── הצבעת-קיוריישן ── */
      case 'steem_vote': {
        const author = String(p.author ?? '');
        const permlink = String(p.permlink ?? '');
        const weightPct = Math.min(100, Math.max(0.1, Number(p.weightPct ?? 10) || 10)); // מדרג-תשואה · חסם-בטיחות 0.1–100
        if (execute) {
          const post = await postInfo(author, permlink).catch(() => null);
          const r = await steemVote({ author, permlink, weightPct });
          await audit('flow-vote', `curation vote: @${author}/${permlink.slice(0, 60)} weight=${weightPct}% by owner:${owner.label} — post-age=${post ? Math.round((Date.now() - new Date(String(post.created)).getTime()) / 3600_000) + 'h' : '?'} title="${String(post?.title ?? '').slice(0, 50)}"`);
          try { await relayBroadcast('vault', { type: 'flow-vote', author, permlink, weightPct }); } catch { /* */ }
          return NextResponse.json({ ok: true, action, dryRun: false, result: r });
        }
        const post = await postInfo(author, permlink).catch(() => null);
        if (!post) return NextResponse.json({ ok: false, action, dryRun: true, error: 'post לא נמצא ב-STEEM' });
        return NextResponse.json({
          ok: true, action, dryRun: true,
          plan: {
            title: String(post.title).slice(0, 80), author: String(post.author), created: String(post.created),
            ageH: Math.round((Date.now() - new Date(String(post.created)).getTime()) / 3600_000),
            netVotes: Number(post.net_votes ?? 0),
            weightPct, note: 'הצבעה אמת מכספת-owner · weightPct של SP-פנוי',
          },
        });
      }

      /* ── פאוורדאון-מנוע (דרך מנוע-הדקס החי · STEEM_ACTIVE_WIF) ── */
      case 'steem_powerdown': {
        const acc = await getAccount('steem');
        const props = await getGlobalProps('steem').catch(() => null);
        if (!acc || !props) return NextResponse.json({ ok: false, action, error: 'steem rpc לא נגיש' });
        const vests = parseFloat(String(acc.vesting_shares ?? '0'));
        const delegated = parseFloat(String(acc.delegated_vesting_shares ?? '0'));
        const available = Math.max(0, vests - delegated);
        const spAvail = vestsToChainVests(available, props);
        if (execute) {
          const vestsStr = `${available.toFixed(6)} VESTS`;
          const r = await dexRealmarket({ action: 'powerdown', vestingShares: vestsStr });
          await audit('flow-powerdown', `withdraw_vesting ${vestsStr} (≈${spAvail.toFixed(1)} SP) via dex-realmarket — verdict=${String(r.json.ok)} ${String(r.json.error ?? r.json.txid ?? '')}`.slice(0, 220));
          if (r.json.ok) { try { await relayBroadcast('vault', { type: 'flow-powerdown', vests: vestsStr }); } catch { /* */ } }
          return NextResponse.json({ ...r.json, action, dryRun: false }, { status: r.status === 503 ? 503 : 200 });
        }
        return NextResponse.json({
          ok: true, action, dryRun: true,
          plan: {
            availableVests: available.toFixed(6), availableSp: spAvail.toFixed(1),
            weeklySp: (spAvail / 4).toFixed(1), weeks: 4,
            note: 'withdraw_vesting משחרר SP פנוי ל-STEEM נזיל — STEEM-HF23: 4 תשלומים שבועיים (הכלל-הישן-היה 13). מזין-מלאי-הספר. החלטה-מבנית של-מפעיל.',
          },
        });
      }

      /* ── חיסכון-HBD ── */
      case 'hive_savings_sweep': {
        const acc = await getAccount('hive').catch(() => null);
        const hbd = acc ? parseFloat(String(acc.hbd_balance ?? '0')) : 0;
        if (execute) {
          const r = await hiveSavingsSweep();
          await audit('flow-savings', `transfer_to_savings ${r.amount} @15% APR by owner:${owner.label}`);
          try { await relayBroadcast('vault', { type: 'flow-savings', amount: r.amount }); } catch { /* */ }
          return NextResponse.json({ ok: true, action, dryRun: false, result: r });
        }
        return NextResponse.json({
          ok: true, action, dryRun: true,
          plan: { hbd: hbd.toFixed(3), floor: 1, apr: '15%', note: hbd >= 1 ? 'מוכן-להפקדה' : 'מתחת-לרצפה — הלולאה תיטען כשהיתרה תגדל' },
        });
      }

      /* ── תביעת-פרסים ── */
      case 'steem_claim': {
        if (execute) {
          const r = await steemClaimRewards();
          await audit('flow-claim', `claim_reward_balance: ${r.claimed} by owner:${owner.label}`);
          return NextResponse.json({ ok: true, action, dryRun: false, result: r });
        }
        return NextResponse.json({ ok: true, action, dryRun: true, plan: { note: 'תביעת-כל-הפרסים-הממתינים (כנה אם 0)' } });
      }

      /* ── אנרגיז-TRX ── */
      case 'trx_energize': {
        const w = await treasuryWallet();
        const info = w?.address ? await tronAccount(w.address).catch(() => null) : null;
        const bal = info?.balance ?? 0;
        const gas = 1.1;
        const amountTrx = Number.isFinite(Number(p.amountTrx)) && Number(p.amountTrx) > 0 ? Number(p.amountTrx) : Math.floor((bal - gas) * 100) / 100;
        if (execute) {
          const r = await trxEnergize(amountTrx);
          await audit('flow-energize', `freezeBalanceV2 ${amountTrx} TRX resource=ENERGY from system-wallet — ${r.ok ? `txid=${r.txid}` : `fail-honest: ${r.error.slice(0, 120)}`} by owner:${owner.label}`);
          if (r.ok) { try { await relayBroadcast('vault', { type: 'flow-energize', amountTrx, txid: r.txid }); } catch { /* */ } }
          return NextResponse.json({ ok: r.ok, action, dryRun: false, ...(r.ok ? { result: r } : { error: r.error }) });
        }
        return NextResponse.json({
          ok: true, action, dryRun: true,
          plan: {
            balance: bal.toFixed(4), amountTrx: amountTrx.toFixed(2), gasReserve: gas,
            note: bal >= 2 ? 'מוכן-לשידור אמת' : 'הארנק ממתין-להפקדה — אין-שידור על-ארנק-ריק (fail-honest)',
          },
        });
      }

      default:
        return NextResponse.json({ ok: false, error: 'action-not-allowed', actions: ['steem_vote', 'steem_powerdown', 'hive_savings_sweep', 'steem_claim', 'trx_energize', 'autovote_pick'] }, { status: 200 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'flow action failed' }, { status: 200 });
  }
}
