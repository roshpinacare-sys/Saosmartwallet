import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import { flowOverview } from '@/lib/saos/flow';
import {
  chainVote, hiveSavingsSweep, claimRewards, curationCandidates, postInfo,
  getAccount, getGlobalProps, vestsToChainVests, ownBlogPosts, OPERATOR, type Chain3,
} from '@/lib/saos/steem-ops';
import { trxEnergize, tronAccount, treasuryWallet } from '@/lib/saos/trx-ops';

export const dynamic = 'force-dynamic';

/* ══ /api/saos/flow — מנוע-הזרימה הריבוני (Task 71-flow · 71-e) ═════════════
 * GET  — תמונת-מצב אמת (אוצר + לולאות + פקדה) · קריאה-בלבד.
 * POST — פעולות: dry-run ברירת-מחדל; execute:true דורש-סשן-מפעיל (requireOwner)
 *        ונרשם-בביקורת + משודר-לריליי. אף-סוד לא נדפס/לא יוצא.
 * 71-e: פעולות-קיוריישן על-שלוש-השרשראות (steem/hive/blurt) — chainVote חותם
 * על chain_id-הנכון לכל-שרשרת (steem-ops.ts). */

const VOTE_CHAINS: Record<string, Chain3> = { steem_vote: 'steem', hive_vote: 'hive', blurt_vote: 'blurt' };

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

/** הצבת-קיוריישן-משותפת לשלוש-השרשראות (dry-run + execute) */
async function voteAction(chain: Chain3, action: string, p: Record<string, unknown>, execute: boolean, ownerLabel: string) {
  const author = String(p.author ?? '');
  const permlink = String(p.permlink ?? '');
  const weightPct = Math.min(100, Math.max(0.1, Number(p.weightPct ?? 10) || 10)); // מדרג-תשואה · חסם-בטיחות 0.1–100
  if (execute) {
    const post = await postInfo(chain, author, permlink).catch(() => null);
    const r = await chainVote(chain, { author, permlink, weightPct });
    await audit(`flow-${chain}-vote`, `curation vote[${chain}]: @${author}/${permlink.slice(0, 60)} weight=${weightPct}% by owner:${ownerLabel} — post-age=${post ? Math.round((Date.now() - new Date(String(post.created)).getTime()) / 3600_000) + 'h' : '?'} title="${String(post?.title ?? '').slice(0, 50)}"`);
    try { await relayBroadcast('vault', { type: `flow-${chain}-vote`, author, permlink, weightPct }); } catch { /* */ }
    return NextResponse.json({ ok: true, action, dryRun: false, result: r });
  }
  const post = await postInfo(chain, author, permlink).catch(() => null);
  if (!post) return NextResponse.json({ ok: false, action, dryRun: true, error: `post לא נמצא ב-${chain.toUpperCase()}` });
  return NextResponse.json({
    ok: true, action, dryRun: true,
    plan: {
      chain: chain.toUpperCase(), title: String(post.title).slice(0, 80), author: String(post.author), created: String(post.created),
      ageH: Math.round((Date.now() - new Date(String(post.created)).getTime()) / 3600_000),
      netVotes: Number(post.net_votes ?? (Array.isArray(post.active_votes) ? post.active_votes.length : 0)),
      weightPct, note: 'הצבעה אמת מכספת-owner · chain_id-נכון-לשרשרת · weightPct של מסה-מצביעה',
    },
  });
}

/** הצבעה-עצמית על הפוסט-החי-האחרון שלנו (publish-author · 71-f) — dry-run פתוח, execute-מאומת */
async function selfVoteAction(p: Record<string, unknown>, execute: boolean, ownerLabel: string) {
  const posts = await ownBlogPosts('steem', 3).catch(() => []);
  const latest = posts[0] ?? null;
  if (!latest) return NextResponse.json({ ok: false, error: 'אין-פוסט-שורש-חי (publish-desk ריק — כנות)' });
  const weightPct = Math.min(100, Math.max(0.1, Number(p.weightPct ?? 100) || 100));
  if (execute) {
    if (latest.hasSelfVote) return NextResponse.json({ ok: false, error: 'כבר-הצבענו-על-הפוסט-הזה (fail-honest — שרשרת-דוחה-כפילות)' });
    const r = await chainVote('steem', { author: OPERATOR, permlink: latest.permlink, weightPct });
    await audit('flow-selfvote', `self-vote on own post ${latest.permlink.slice(0, 60)} weight=${weightPct}% by owner:${ownerLabel} — dual-return (author 50% SBD+SP + curation 50% VESTS)`);
    try { await relayBroadcast('vault', { type: 'flow-selfvote', permlink: latest.permlink, weightPct }); } catch { /* */ }
    return NextResponse.json({ ok: true, action: 'steem_selfvote', dryRun: false, result: r });
  }
  return NextResponse.json({
    ok: true, action: 'steem_selfvote', dryRun: true,
    plan: {
      title: latest.title.slice(0, 60), permlink: latest.permlink,
      ageH: Math.round((Date.now() - new Date(latest.created).getTime()) / 3600_000),
      pending: `$${latest.pendingSbd.toFixed(3)}`, votes: latest.votes, alreadyVoted: latest.hasSelfVote, weightPct,
      note: 'הצבעה-עצמית = זרימה-כפולה-חוזרת-אלינו: 50% author + 50% curation. VP-נצבר-בכל-מקרה — לא-להצביע = בזבוז.',
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { action?: string; execute?: boolean; params?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 200 }); }
  const action = String(body.action ?? '');
  const execute = body.execute === true;
  const p = body.params ?? {};

  // autovote_pick הוא read-only — פתוח-בלי-סשן (בחירת-מועמד לתצוגה) · 71-e: לכל-שרשרת
  if (action === 'autovote_pick') {
    try {
      const chain: Chain3 = p.chain === 'hive' ? 'hive' : p.chain === 'blurt' ? 'blurt' : 'steem';
      const tag = typeof p.tag === 'string' ? p.tag : '';
      const cands = await curationCandidates(chain, tag);
      return NextResponse.json({ ok: true, action, dryRun: true, chain, candidates: cands.slice(0, 5) });
    } catch (e) {
      return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'pick failed' }, { status: 200 });
    }
  }

  // 71-e: dry-run-הצבעה = מידע-פומבי-בלבד (get_content) — לא-דורש-סשן. execute-מחייב-מפעיל.
  const dryChain = VOTE_CHAINS[action];
  if (dryChain && execute !== true) {
    return await voteAction(dryChain, action, p, false, '');
  }
  // 71-f: dry-run-הצבעה-עצמית = מידע-פומבי (get_discussions_by_blog) — פתוח. execute-מאומת.
  if (action === 'steem_selfvote' && execute !== true) {
    return await selfVoteAction(p, false, '');
  }

  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'auth-required', note: 'התחבר כמפעיל כדי להריץ פעולות-זרימה' }, { status: 401 });

  try {
    switch (action) {
      /* ── הצבעות-קיוריישן — STEEM/HIVE/BLURT (71-e: מנוע-משותף · execute-בלבד כאן) ── */
      case 'steem_vote':
      case 'hive_vote':
      case 'blurt_vote':
        return await voteAction(VOTE_CHAINS[action], action, p, execute, owner.label);

      /* ── הצבעה-עצמית על הפוסט-שלנו (publish-author · 71-f) ── */
      case 'steem_selfvote':
        return await selfVoteAction(p, execute, owner.label);

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

      /* ── תביעת-פרסים — STEEM/HIVE (71-e: HIVE נוסף) ── */
      case 'steem_claim':
      case 'hive_claim': {
        const chain: 'steem' | 'hive' = action === 'hive_claim' ? 'hive' : 'steem';
        if (execute) {
          const r = await claimRewards(chain);
          await audit(`flow-${chain}-claim`, `claim_reward_balance[${chain}]: ${r.claimed} by owner:${owner.label}`);
          return NextResponse.json({ ok: true, action, dryRun: false, result: r });
        }
        return NextResponse.json({ ok: true, action, dryRun: true, plan: { note: `תביעת-כל-הפרסים-הממתינים ב-${chain.toUpperCase()} (כנה אם 0)` } });
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
        return NextResponse.json({ ok: false, error: 'action-not-allowed', actions: ['steem_vote', 'hive_vote', 'blurt_vote', 'steem_selfvote', 'steem_powerdown', 'hive_savings_sweep', 'steem_claim', 'hive_claim', 'trx_energize', 'autovote_pick'] }, { status: 200 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'flow action failed' }, { status: 200 });
  }
}
