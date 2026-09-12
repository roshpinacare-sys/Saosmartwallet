export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { generateApiKey } from "@/lib/api-keys";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Developer key console — ALL routes admin-gated (Model 1 W1 gap closed;
 * roast r6 closed the last two: GET /keys and GET /usage answered ANONYMOUSLY,
 * leaking internal key names/prefixes/activity — internal vocabulary is not
 * a secret-free zone, it is exactly the leak class the codename doctrine
 * forbids; the documented "GET stays open" decision of r4 is REVOKED here).
 *
 * POST   { name }  → create; the plaintext key is returned EXACTLY ONCE
 * DELETE ?id=      → revoke (soft: stays for usage history, blocks product calls)
 */

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  callsToday: number;
  callsTotal: number;
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function GET(req: Request) {
  const adminGate = await requireAdmin(req);
  if (adminGate) return adminGate;
  const rows = await db.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    include: { records: { select: { createdAt: true } } },
  });
  const dayStart = startOfUtcDay();
  const keys: KeyRow[] = rows.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    active: k.active,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    callsToday: k.records.filter((r) => r.createdAt >= dayStart).length,
    callsTotal: k.records.length,
  }));
  return NextResponse.json({ ok: true, keys }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const adminGate = await requireAdmin(req);
  if (adminGate) return adminGate;
  let name = "unnamed key";
  try {
    const body = (await req.json()) as { name?: string };
    if (typeof body?.name === "string" && body.name.trim()) name = body.name.trim().slice(0, 64);
  } catch {
    // default name applies
  }
  const g = generateApiKey();
  const rec = await db.apiKey.create({
    data: { name, prefix: g.prefix, keyHash: g.keyHash },
  });
  return NextResponse.json(
    {
      ok: true,
      key: g.key, // plaintext — shown ONCE, only the hash is stored
      created: { id: rec.id, name: rec.name, prefix: rec.prefix, createdAt: rec.createdAt.toISOString() },
      warning: "Copy it now — this exact value is never shown again (only its SHA-256 is stored).",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(req: Request) {
  const adminGate = await requireAdmin(req);
  if (adminGate) return adminGate;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing ?id=" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const existing = await db.apiKey.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "key not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  await db.apiKey.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true, revoked: existing.prefix }, { headers: { "Cache-Control": "no-store" } });
}
