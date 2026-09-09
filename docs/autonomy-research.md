# AUTONOMY ENGINEERING — research + implementation (Gate Heart)

> מקור המשימה: "בחן את כל התיקיות בגיטהאב כולל קבצי הזיפ — יש שם תוכן רלוונטי
> שיכול להועיל להרכיב את זה טוב יותר… הנדסה קשה לאוטונומיה על הרשת שלנו".
> מסמך זה מתעד את המחקר, את הדפוסים שנלמדו, ואת מה שבאמת נבנה ואומת.

## 1 · The sources (real content, examined)

| Source | Where | What it taught |
|---|---|---|
| **steem agent army** | `roshpinacare-sys/steem` → `agent/` (304 files: agent.cjs daemon, DAEMONS.md, THE_WEAVE.md, ENGINEER_BRIEF.md, ~60 daemons) | one daemon hosting many loops · interval+threshold triggers · shared snapshot cache (5 loops = 1 RPC) · watermark cursors · daily caps · `--once` proof mode · LIVE-GATE contract (dry by default, two-key go-live) · fail-isolation per loop |
| **SRS sovereign-runtime-substrate v8.2.0** | `Project-files/*.zip` | interrupted-run resume via in-flight files · atomic snapshots (fsync+replace, HMAC, monotonic sequence) · advice table = keyed cross-run learning |
| **ECOS v568** | `Project-files/*.zip` | diamond heartbeat (5-min, fail-closed, opt-in) · governanceTick "the missing beat" (a pulse that doesn't govern is decorative) · agentBus typed channels + dead-letter · HITL spend gates · scheduler state persisted across reboots |
| **TFA evolution studio** | `Project-files/*.zip` | 10-phase run lifecycle with cancellation+evidence · memory graph with findBestRecovery · soak harness (p50/p95/p99 + recovery rate) |
| **workspace TCP** | `Project-files/*.zip` | claim semantics: priority+`claimedBy`+`claimExpiresAt` visibility timeout · `reapExpiredClaims()` · transactional outbox · policy kill-switch/rate-limiter/spend-guard |
| **TITAI v18** | `Project-files/*.zip` | durable jobs on SQLite: lease claim + heartbeat renewal mid-run · checkpoint `{nextStepIndex}` (the trace IS the checkpoint) · bounded pull-based worker pass · approval-continuation |

Full downloaded/extracted material kept locally at `engineering/autonomy-input/` (gitignored — external content stays out of the repo).

## 2 · What was already there vs. the gaps

Before this task the harness had (Task 6+7): goal-loop with maker/checker separation,
7 real modules, step budgets, lessons across runs, protocol rescues, repair rounds,
per-step ms + tokens. **Every run needed an operator click.** Gaps (user-named):
no self-waking, no schedules, no event reactions, no inter-agent coordination,
no crash recovery (a restart orphaned a `running` run forever), no autonomy kill-switch.

## 3 · The Gate Heart — what was built (all real, all verified live)

**Boot**: `src/instrumentation.ts` → `startHeart()` — in-process `setInterval`
(globalThis-pinned, HMR-safe, no extra port). Tick = 20s bounded pull pass.

| Stage | Mechanism | Source pattern |
|---|---|---|
| kill-switch | `GateConfig.autonomyEnabled` checked first — OFF drains to clean stop | steem LIVE-GATE + TCP kill-switch |
| REAPER | expired leases → back to `queued`; attempt≥max → honest `failed` | TCP reapExpiredClaims |
| SCHEDULER | `GateSchedule` rows (interval/daily, `maxPerDay`+dayKey caps, skip-honest defer when agent busy) → enqueues patrols | steem daemon loops + ECOS scheduler persistence |
| TRIGGERS | `GateEvent` (outbox) → `GateTrigger` rules (cooldown + daily cap) → reactive runs; mentions of `@agent` in the bridge, `run.blocked` self-repair chase | workspace outbox + steem commandBus |
| DISPATCH | atomic CAS claim (`updateMany where status=queued`) + lease (180s, renewed every persisted step); caps: 2 concurrent, 1 goal/agent, 2 dispatched/tick | TITAI lease+heartbeat |
| PULSE | self-observability record in `GateState` (beats, cumulative counters, per-loop status) — survives restarts (counters carried forward) | steem agent-status.json |

**Crash recovery**: the persisted trace IS the checkpoint — a re-claimed run with
`attempt>1` enters RECOVERY mode: the maker reloads the trace and continues from
the evidence ("RECOVERED (attempt 2/2) — המשך בדיוק מאיפה שנעצרת").

**Sovereignty**: heart-launched runs never break the vault — NVIDIA brains need the
sealed master, so when the vault is sealed the heart swaps to `zai:default` and says
so in `meta.brainNote`. Unarmed agents are refused ("autonomy without hands is waste").

**Self-healing policy**: `ensureTriggerPolicy()` runs every beat — an agent armed
later automatically gets its mention trigger; the `run.blocked` repair-chase trigger
always exists. Seeding is idempotent and bounded.

**New modules**: `chat.send` (direct agent→agent message, emits a real mention event)
and `inbox.read` (the agent's direct+mentioned messages) — chaintalk in miniature.

**New API**: `GET/POST /api/gate/heart` (pulse + kill-switch) ·
`GET/POST/PATCH/DELETE /api/gate/schedule` (patrol management).

## 4 · Live verification evidence (19:00–19:20 UTC window, zero operator clicks for every autonomous run)

- **Schedule**: seeded patrol fired alone → `origin=schedule` → the unarmed target honestly **blocked** → `run.blocked` event → **self-repair chase fired** (`origin=trigger`) → capped by cooldown+daily-cap. After retarget to the armed agent: patrol passed (real `vault.stats` + `chain.steem` evidence, Hebrew report on the bridge).
- **Mention trigger**: operator wrote `@harness-rider …` → within ~40s a run (`origin=trigger`) verified chain health (`reachable:true`) and reported — **done**, 4/5 steps, 3709→560 tokens, 32.8s.
- **Multi-agent**: `@anchor-agent` asked to coordinate → read `inbox.read` → `chat.send` to harness-rider → harness-rider ran autonomously and **done**; anchor-agent's own run was **blocked by the checker** ("no evidence of a response") — the pass-gate refusing self-graded success, exactly as designed.
- **Kill switch**: OFF → due patrol did NOT fire (26s observed); ON → fired within one beat.
- **Crash recovery**: planted a crashed run (dead lease, attempt=1, 1 persisted step) → reaper requeued → re-claimed attempt=2 → maker resumed from the trace → **done**.
- **UI**: pulse card live (beat age, cumulative counters), 3 patrols with next-fire times, event feed, trigger policy panel, origin badges in the runs log (⏰ סיור / ⚡ טריגר / 🫀 התאושש), patrol creation from the form → fired within a minute.
- **Mobile 390px**: no horizontal overflow; sticky footer intact; device auto-login after reload (no key).

## 5 · Efficiency — the why/how-much/who/what/how ledger

- **למה (why)**: every run carries `origin` + `meta` (scheduleId/triggerId/eventId) — lineage answerable in the UI and API.
- **כמה (how much)**: per-run `durationMs`, `tokens{prompt,completion}`, steps/budget; per-agent fleet stats; per-beat pulse counters (dispatched/recovered/patrols/triggers/reaped/deferred) cumulative across restarts.
- **מי (who)**: agent name + brain + checker on every run; trigger target resolved from the event payload.
- **מה (what)**: goal + doneMeans contract on the row; the trace proves it.
- **איך (how)**: bounded — step budget, 2 concurrent max, 1 goal/agent, cooldowns (120s mentions / 300s repair-chase), daily caps (12 mentions / 2 repairs / patrol maxPerDay), honest failure at attempt≥2.

Fleet after verification: harness-rider 13 runs · 9 done · avg 3.8 steps.
anchor-agent 4 runs · 0 done · 4 blocked — all blocks earned by the checker
demanding response-evidence for coordination goals (correct strictness).
