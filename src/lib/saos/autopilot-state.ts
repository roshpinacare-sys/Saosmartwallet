/**
 * autopilot-state.ts (71-h) — קבצי-מצב-וקונפיג של-האוטופיילוט (בלי-סודות).
 * השירות (mini-services/flow-autopilot · :3020) כותב מצב-אמת אחרי-כל-מעגל;
 * המנוע (flow.ts) קורא ומציג; המפעיל שולט דרך flow POST (pause/resume/config).
 * קריאה-כושלת = null — המנוע מציג "אין-דיווח" (כנות, לא-אפסים-מזויפים).
 */
import fs from 'fs';
import path from 'path';

export interface AutopilotAction { ts: number; kind: string; detail: string }
export interface AutopilotState {
  ok: true;
  service: 'flow-autopilot';
  bootTs: number;
  enabled: boolean;
  cycles: number;
  lastCycleAt: number | null;
  nextCycleAt: number | null;
  intervalMin: number;
  weightPct: number;
  totals: { claims: number; votes: number; selfvotes: number; publishes: number };
  lastActions: AutopilotAction[];
  errors: AutopilotAction[];
}
export interface AutopilotConfig {
  enabled: boolean;
  intervalMin: number;   // 15–720
  weightPct: number;     // 0.1–100 (STEEM curation)
  hiveWeightPct: number; // 0 = כבוי
  blurtWeightPct: number;// 0 = כבוי
  selfvoteEnabled: boolean;
  publishEnabled: boolean;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'autopilot-state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'autopilot-config.json');

export const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: true,
  intervalMin: 60,
  weightPct: 10,
  hiveWeightPct: 1,
  blurtWeightPct: 1,
  selfvoteEnabled: true,
  publishEnabled: true,
};

export function readAutopilotState(): AutopilotState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw) as AutopilotState;
    return j && j.ok && j.service === 'flow-autopilot' ? j : null;
  } catch { return null; }
}

export function readAutopilotConfig(): AutopilotConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const j = JSON.parse(raw) as Partial<AutopilotConfig>;
    if (!j || typeof j !== 'object') return null;
    return { ...DEFAULT_CONFIG, ...j };
  } catch { return null; }
}

/** מיזוג-קונפיג מהמפעיל — clamp-קשיח לכל-שדה (fail-safe) */
export function writeAutopilotConfig(patch: Partial<AutopilotConfig>): AutopilotConfig {
  const cur = readAutopilotConfig() ?? { ...DEFAULT_CONFIG };
  const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const next: AutopilotConfig = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : cur.enabled,
    intervalMin: patch.intervalMin !== undefined ? clampNum(patch.intervalMin, 15, 720, cur.intervalMin) : cur.intervalMin,
    weightPct: patch.weightPct !== undefined ? clampNum(patch.weightPct, 0.1, 100, cur.weightPct) : cur.weightPct,
    hiveWeightPct: patch.hiveWeightPct !== undefined ? clampNum(patch.hiveWeightPct, 0, 100, cur.hiveWeightPct) : cur.hiveWeightPct,
    blurtWeightPct: patch.blurtWeightPct !== undefined ? clampNum(patch.blurtWeightPct, 0, 100, cur.blurtWeightPct) : cur.blurtWeightPct,
    selfvoteEnabled: typeof patch.selfvoteEnabled === 'boolean' ? patch.selfvoteEnabled : cur.selfvoteEnabled,
    publishEnabled: typeof patch.publishEnabled === 'boolean' ? patch.publishEnabled : cur.publishEnabled,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}
