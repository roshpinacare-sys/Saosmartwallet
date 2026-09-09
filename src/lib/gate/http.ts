import { NextResponse } from "next/server";
import { GateError } from "./crypto";

export function ok(data: unknown) {
  return NextResponse.json({ ok: true, ...(data as object) });
}
export function fail(err: unknown) {
  if (err instanceof GateError) {
    return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: err.code === "vault-locked" ? 423 : 400 });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ ok: false, code: "internal", error: msg }, { status: 500 });
}
