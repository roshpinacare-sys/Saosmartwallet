/**
 * Saosmartwallet — policy engine (layer 3)
 * ========================================
 * Deterministic, side-effect-free evaluation of one operation against:
 *   1. compiled-in static rules (see policy/defaults.ts),
 *   2. persisted dynamic rules (amount threshold / deny-list / approvals / step-up),
 *   3. persisted contextual rules (time window / rate / counterparty / device),
 *   4. persisted composite rules (depth-1 any/all over 2+3),
 *   5. six anomaly detectors over the audit-derived history.
 *
 * The result is a {@link PolicyDecision} meant for the signing dialog:
 * human-readable reasons, a full rule-by-rule trace, merged requirements and a
 * risk score.
 *
 * ## Semantics pinned here (the engine contract)
 * - A failing outcome whose action is NOT a soft action (`require_approval`,
 *   `step_up_auth`) is a HARD DENY — including a missing or `"allow"` action
 *   (fail-closed). Static rules are all evaluated even after a deny.
 * - Dynamic rules: condition knobs are `amountThreshold` (per-symbol satoshi
 *   cap; unknown symbol skips the rule) and `deniedOperations`. When a rule
 *   triggers, `requireApprovalCount` (if set) converts the violation into an
 *   approval requirement — otherwise the rule hard-denies. A dynamic rule with
 *   `requireApprovalCount` but NO condition knobs applies to every operation.
 *   `stepUpFor` is an independent type-match → step-up requirement.
 * - Contextual rules apply their `action` when any configured constraint is
 *   violated: time windows are "HH:MM"–"HH:MM" UTC (start-inclusive,
 *   end-exclusive, wrap-around supported, malformed window fails closed);
 *   `maxOperationsPerHour` fires when history already holds ≥ cap entries in
 *   the trailing hour (the current op would be the cap+1-th);
 *   `newActionCooldownHours: 0` disables the cooldown check.
 * - Composite rules resolve refs ONE level deep against dynamic/contextual
 *   results; unresolved refs are ignored (noted in the trace); empty refs never
 *   trigger.
 * - `stepUpSatisfied` in the context DROPS the step-up requirement (already
 *   verified this session); it never overrides a hard deny.
 * - Disabled rules are skipped entirely (no trace entry).
 * - `timeLock` requirements are an orchestrator-layer concern; no M2 rule
 *   produces one.
 */

import { parseSats } from "../encoding";
import type {
  Anomaly,
  AnomalyScore,
  CompositeRule,
  ContextualRule,
  DynamicRule,
  OperationContext,
  PolicyDecision,
  PolicyOperation,
  PolicyRuleSet,
  RiskLevel,
  RuleOutcome,
  StaticRule,
} from "../types";
import { STATIC_RULES, formatSats } from "./defaults";

/** Approver id used for additional-approval requirements (the master vault). */
const MASTER_APPROVER = "master";

const HOUR_MS = 3_600_000;
const TEN_MINUTES_MS = 600_000;

/** Side-requirements a rule outcome can impose on the aggregate decision. */
interface RuleEffect {
  /** Number of additional guardian approvals demanded (["master"] × N). */
  approvals?: number;
  /** Step-up authentication demanded (even on a passing outcome). */
  stepUp?: boolean;
}

/** Internal evaluation record for a single rule. */
interface RuleResult {
  ruleId: string;
  name: string;
  outcome: RuleOutcome;
  effect: RuleEffect;
}

/** Maps an aggregate anomaly score to a risk band (0–24 low, 25–49 medium, 50–74 high, 75+ critical). */
function riskFromScore(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

/** Parses "HH:MM" into minutes-since-midnight, or null when malformed. */
function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Returns a human-readable violation when `hourOfDay` is OUTSIDE the UTC time
 * window; null when inside. Windows are start-inclusive / end-exclusive, may
 * wrap midnight ("22:00"–"06:00"), and a malformed or zero-length window fails
 * closed (always outside).
 */
function windowViolation(timeWindow: { start: string; end: string }, hourOfDay: number): string | null {
  const startMin = parseHm(timeWindow.start);
  const endMin = parseHm(timeWindow.end);
  if (startMin === null || endMin === null) {
    return `time window ${timeWindow.start}–${timeWindow.end} is malformed`;
  }
  const cur = hourOfDay * 60;
  const inside = startMin <= endMin ? cur >= startMin && cur < endMin : cur >= startMin || cur < endMin;
  return inside
    ? null
    : `outside the allowed time window ${timeWindow.start}–${timeWindow.end} UTC (current hour ${String(hourOfDay).padStart(2, "0")}:00)`;
}

/** The per-action effect attached when a contextual/composite rule fails. */
function effectForAction(action: ContextualRule["action"], approvals = 1): RuleEffect {
  if (action === "require_approval") return { approvals };
  if (action === "step_up_auth") return { stepUp: true };
  return {};
}

/**
 * The policy engine. Stateless beyond its (immutable) static rules — one
 * instance can be shared across requests.
 */
export class PolicyEngine {
  private readonly staticRules: StaticRule[];

  /**
   * @param staticRules — compiled-in rules evaluated on every operation;
   *   defaults to {@link STATIC_RULES}. Injectable for tests and forks.
   */
  constructor(staticRules: StaticRule[] = STATIC_RULES) {
    this.staticRules = staticRules;
  }

  /**
   * Full evaluation pipeline (static → dynamic → contextual → composite →
   * anomalies → aggregate). Pure: never mutates `op`, `ctx` or `rules`.
   *
   * Aggregation rules:
   * - `allowed` — false iff any outcome hard-denied.
   * - `requirements.additionalApprovals` — ["master"] × max approval count
   *   across rules (contextual/composite `require_approval` counts as 1).
   * - `requirements.stepUpAuth` — OR of all step-up demands, DROPPED when
   *   `ctx.stepUpSatisfied` is true.
   * - `confidence` — `1 - score/200` clamped to 0.5..1 when allowed (allows
   *   never look shakier than 0.5); the same value without the floor when
   *   denied (a denial may legitimately carry low confidence at high risk).
   * - `riskLevel` — from the anomaly score (0–24 low, 25–49 medium, 50–74
   *   high, 75+ critical).
   * - `reasons` — human-readable lines for every failed rule plus the merged
   *   requirements; "All policy checks passed." when nothing fired.
   * - `checks` — the full rule-by-rule trace for the signing dialog.
   */
  evaluate(op: PolicyOperation, ctx: OperationContext, rules: PolicyRuleSet): PolicyDecision {
    const checks: PolicyDecision["checks"] = [];
    const results: RuleResult[] = [];
    let hardDeny = false;
    let approvals = 0;
    let stepUp = false;

    const collect = (ruleId: string, name: string, outcome: RuleOutcome, effect: RuleEffect = {}): RuleResult => {
      const result: RuleResult = { ruleId, name, outcome, effect };
      checks.push({ ruleId, name, pass: outcome.pass, detail: outcome.reason });
      results.push(result);
      if (!outcome.pass) {
        if (outcome.action === "require_approval") approvals = Math.max(approvals, effect.approvals ?? 1);
        else if (outcome.action === "step_up_auth") stepUp = true;
        else hardDeny = true; // deny, missing, or "allow" — fail closed
      } else {
        if (effect.approvals !== undefined) approvals = Math.max(approvals, effect.approvals);
        if (effect.stepUp) stepUp = true;
      }
      return result;
    };

    // 1. Static rules — always all of them.
    for (const rule of this.staticRules) {
      collect(rule.id, rule.name, rule.evaluate(op, ctx));
    }

    // Rule results visible to composite refs (dynamic + contextual, depth 1).
    const byId = new Map<string, RuleResult>();

    // 2. Dynamic rules.
    for (const rule of rules.dynamic) {
      if (!rule.enabled) continue;
      const r = this.evaluateDynamic(rule, op);
      const result = collect(rule.id, rule.name, r.outcome, r.effect);
      if (!byId.has(rule.id)) byId.set(rule.id, result);
    }

    // 3. Contextual rules.
    for (const rule of rules.contextual) {
      if (!rule.enabled) continue;
      const r = this.evaluateContextual(rule, op, ctx);
      const result = collect(rule.id, rule.name, r.outcome, r.effect);
      if (!byId.has(rule.id)) byId.set(rule.id, result);
    }

    // 4. Composite rules (depth 1 — refs resolve to dynamic/contextual only).
    for (const rule of rules.composite) {
      if (!rule.enabled) continue;
      const r = this.evaluateComposite(rule, byId);
      collect(rule.id, rule.name, r.outcome, r.effect);
    }

    // 5. Anomaly detection.
    const { score, anomalies } = this.detectAnomalies(op, ctx);

    // 6. Aggregate.
    const requirements: NonNullable<PolicyDecision["requirements"]> = {};
    let stepUpDropped = false;
    if (stepUp) {
      if (ctx.stepUpSatisfied) stepUpDropped = true;
      else requirements.stepUpAuth = true;
    }
    if (approvals > 0) {
      requirements.additionalApprovals = Array.from({ length: approvals }, () => MASTER_APPROVER);
    }

    const allowed = !hardDeny;
    const rawConfidence = 1 - score / 200;
    const confidence = allowed ? Math.min(1, Math.max(0.5, rawConfidence)) : Math.min(1, Math.max(0, rawConfidence));

    const reasons: string[] = [];
    for (const r of results) {
      if (!r.outcome.pass) reasons.push(r.outcome.reason);
    }
    if (requirements.additionalApprovals !== undefined) {
      reasons.push(
        `Requires ${approvals} additional guardian approval${approvals === 1 ? "" : "s"} before execution.`,
      );
    }
    if (requirements.stepUpAuth === true) {
      reasons.push("Step-up authentication (password re-entry) is required before signing.");
    }
    if (stepUpDropped) {
      reasons.push("Step-up authentication was already satisfied in this session.");
    }
    if (reasons.length === 0) reasons.push("All policy checks passed.");

    const decision: PolicyDecision = {
      allowed,
      confidence,
      reasons,
      riskLevel: riskFromScore(score),
      anomalies,
      checks,
    };
    if (Object.keys(requirements).length > 0) decision.requirements = requirements;
    return decision;
  }

  /**
   * Six pure anomaly detectors over the audit-derived history. Only detectors
   * that actually fire contribute entries; the aggregate score is
   * `min(100, Σ scores)`.
   *
   * - `frequency_spike` — ops in the trailing 60 min vs
   *   `averageOperationsPerHour`; ratio > 3 → medium, `min(40, 10×ratio)`.
   * - `unusual_amount` — amount > 3× `averageTransferSatoshis` → medium (25);
   *   > 10× → high (still 25).
   * - `new_counterparty` — counterparty set but not typical → low (15).
   * - `odd_hour` — 02:00–05:00 UTC → low (10).
   * - `rapid_fire` — > 5 ops in the trailing 10 min → high (30).
   * - `failed_history` — ≥ 3 failures in the trailing hour → medium (20).
   */
  detectAnomalies(op: PolicyOperation, ctx: OperationContext): AnomalyScore {
    const anomalies: Anomaly[] = [];
    const now = ctx.timestamp;

    // 1. frequency_spike
    const avgPerHour = ctx.userBehavior.averageOperationsPerHour;
    if (avgPerHour > 0) {
      const recent = ctx.history.filter((h) => h.timestamp > now - HOUR_MS).length;
      const ratio = recent / avgPerHour;
      if (ratio > 3) {
        anomalies.push({
          kind: "frequency_spike",
          severity: "medium",
          score: Math.min(40, Math.round(10 * ratio)),
          description: `Activity spike: ${recent} operations in the last hour versus ${Math.round(avgPerHour * 10) / 10} typical (×${Math.round(ratio * 10) / 10}).`,
        });
      }
    }

    // 2. unusual_amount
    if (op.amountSatoshis !== "0" && ctx.userBehavior.averageTransferSatoshis !== "0") {
      try {
        const amount = parseSats(op.amountSatoshis);
        const avg = parseSats(ctx.userBehavior.averageTransferSatoshis);
        if (avg > 0n && amount > avg * 3n) {
          anomalies.push({
            kind: "unusual_amount",
            severity: amount > avg * 10n ? "high" : "medium",
            score: 25,
            description: `Unusual amount: ${formatSats(amount)} satoshis is roughly ${formatSats(amount / avg)}× the ${formatSats(avg)} satoshi average transfer for this vault.`,
          });
        }
      } catch {
        // Malformed amount strings — the detector skips; amounts are
        // orchestrator-validated elsewhere.
      }
    }

    // 3. new_counterparty
    if (op.counterparty !== null && op.counterparty !== "" && !ctx.userBehavior.typicalCounterparties.includes(op.counterparty)) {
      anomalies.push({
        kind: "new_counterparty",
        severity: "low",
        score: 15,
        description: `First-seen counterparty "${op.counterparty}" has no established history with this vault.`,
      });
    }

    // 4. odd_hour
    if (ctx.hourOfDay >= 2 && ctx.hourOfDay <= 5) {
      anomalies.push({
        kind: "odd_hour",
        severity: "low",
        score: 10,
        description: `Operation at ${String(ctx.hourOfDay).padStart(2, "0")}:00 UTC — an unusual hour for account activity.`,
      });
    }

    // 5. rapid_fire
    const rapid = ctx.history.filter((h) => h.timestamp > now - TEN_MINUTES_MS).length;
    if (rapid > 5) {
      anomalies.push({
        kind: "rapid_fire",
        severity: "high",
        score: 30,
        description: `Rapid-fire activity: ${rapid} operations in the last 10 minutes.`,
      });
    }

    // 6. failed_history
    const failed = ctx.history.filter((h) => h.result === "failure" && h.timestamp > now - HOUR_MS).length;
    if (failed >= 3) {
      anomalies.push({
        kind: "failed_history",
        severity: "medium",
        score: 20,
        description: `${failed} failed operations in the last hour — possible compromised-session probing.`,
      });
    }

    const score = Math.min(100, anomalies.reduce((sum, a) => sum + a.score, 0));
    return { score, anomalies };
  }

  /**
   * Evaluates one dynamic rule: condition knobs (`amountThreshold`,
   * `deniedOperations`) decide whether it triggers; the response is an
   * approval requirement when `requireApprovalCount` is set, otherwise a hard
   * deny. `stepUpFor` is evaluated independently of the trigger. A rule with
   * `requireApprovalCount` and no condition knobs applies unconditionally.
   * Malformed threshold/amount values fail closed.
   */
  private evaluateDynamic(rule: DynamicRule, op: PolicyOperation): { outcome: RuleOutcome; effect: RuleEffect } {
    const hasCondition = rule.amountThreshold !== undefined || rule.deniedOperations !== undefined;
    let trigger: string | null = null;
    let malformed = false;

    if (rule.amountThreshold !== undefined) {
      const thresholdStr = rule.amountThreshold[op.symbol];
      if (thresholdStr !== undefined) {
        try {
          const amount = parseSats(op.amountSatoshis);
          const threshold = parseSats(thresholdStr);
          if (amount > threshold) {
            trigger = `amount ${formatSats(amount)} satoshis (${op.symbol}) exceeds the ${formatSats(threshold)} satoshi threshold`;
          }
        } catch {
          trigger = "operation amount or threshold configuration is malformed";
          malformed = true;
        }
      }
      // Unknown symbol → threshold not applicable (skipped by contract).
    }
    if (trigger === null && rule.deniedOperations !== undefined && rule.deniedOperations.some((t) => t === op.type)) {
      trigger = `operation type ${op.type} is deny-listed`;
    }

    if (trigger !== null) {
      if (!malformed && rule.requireApprovalCount !== undefined && rule.requireApprovalCount > 0) {
        return {
          outcome: {
            pass: false,
            action: "require_approval",
            reason: `${rule.name}: ${trigger} — ${rule.requireApprovalCount} additional guardian approval${rule.requireApprovalCount === 1 ? "" : "s"} required.`,
          },
          effect: { approvals: rule.requireApprovalCount },
        };
      }
      return {
        outcome: { pass: false, action: "deny", reason: `${rule.name}: ${trigger} — operation denied.` },
        effect: {},
      };
    }

    if (rule.stepUpFor !== undefined && rule.stepUpFor.some((t) => t === op.type)) {
      return {
        outcome: {
          pass: true,
          action: "step_up_auth",
          reason: `${rule.name}: step-up authentication is required for ${op.type}.`,
        },
        effect: { stepUp: true },
      };
    }

    if (!hasCondition && rule.requireApprovalCount !== undefined && rule.requireApprovalCount > 0) {
      return {
        outcome: {
          pass: true,
          action: "require_approval",
          reason: `${rule.name}: every operation requires ${rule.requireApprovalCount} additional guardian approval${rule.requireApprovalCount === 1 ? "" : "s"}.`,
        },
        effect: { approvals: rule.requireApprovalCount },
      };
    }

    return { outcome: { pass: true, reason: `${rule.name}: no trigger for this operation.` }, effect: {} };
  }

  /**
   * Evaluates one contextual rule — the first violated constraint wins the
   * violation message; a violation applies the rule's `action` ("deny" is a
   * hard deny, "require_approval"/"step_up_auth" are soft requirements,
   * "allow" fails closed per the engine contract).
   */
  private evaluateContextual(
    rule: ContextualRule,
    op: PolicyOperation,
    ctx: OperationContext,
  ): { outcome: RuleOutcome; effect: RuleEffect } {
    let violation: string | null = null;

    if (rule.timeWindow !== undefined) {
      violation = windowViolation(rule.timeWindow, ctx.hourOfDay);
    }
    if (violation === null && rule.maxOperationsPerHour !== undefined) {
      const recent = ctx.history.filter((h) => h.timestamp > ctx.timestamp - HOUR_MS).length;
      if (recent >= rule.maxOperationsPerHour) {
        violation = `${recent} operations in the last hour exceeds the cap of ${rule.maxOperationsPerHour}`;
      }
    }
    if (violation === null && rule.newActionCooldownHours !== undefined && rule.newActionCooldownHours > 0) {
      const cp = op.counterparty;
      if (
        cp !== null &&
        cp !== "" &&
        !ctx.userBehavior.typicalCounterparties.includes(cp) &&
        !ctx.history.some((h) => h.counterparty === cp && h.result === "success")
      ) {
        violation = `counterparty "${cp}" is first-seen with no successful history (cooldown ${rule.newActionCooldownHours}h)`;
      }
    }
    if (violation === null && rule.requireTrustedDevice === true && !ctx.trustedDevice) {
      violation = "the current session is not on a trusted device";
    }

    if (violation === null) {
      return { outcome: { pass: true, reason: `${rule.name}: satisfied for this operation.` }, effect: {} };
    }
    return {
      outcome: { pass: false, action: rule.action, reason: `${rule.name}: ${violation}.` },
      effect: effectForAction(rule.action),
    };
  }

  /**
   * Evaluates one composite rule over the already-computed dynamic/contextual
   * results (depth 1 — refs never resolve to other composites). `any` triggers
   * when at least one referenced rule failed; `all` when every referenced rule
   * failed (unresolved refs count as "not failed", so they block `all`).
   * Empty refs never trigger.
   */
  private evaluateComposite(rule: CompositeRule, byId: Map<string, RuleResult>): { outcome: RuleOutcome; effect: RuleEffect } {
    const failed: string[] = [];
    const missing: string[] = [];
    for (const ref of rule.refs) {
      const r = byId.get(ref);
      if (r === undefined) missing.push(ref);
      else if (!r.outcome.pass) failed.push(ref);
    }
    const triggered =
      rule.refs.length > 0 &&
      (rule.operator === "any" ? failed.length > 0 : failed.length === rule.refs.length);
    const note = missing.length > 0 ? ` (unresolved refs ignored: ${missing.join(", ")})` : "";

    if (!triggered) {
      return { outcome: { pass: true, reason: `${rule.name}: satisfied${note}.` }, effect: {} };
    }
    return {
      outcome: {
        pass: false,
        action: rule.action,
        reason: `${rule.name}: composite trigger (${rule.operator} of [${failed.join(", ")}])${note}.`,
      },
      effect: effectForAction(rule.action),
    };
  }
}
