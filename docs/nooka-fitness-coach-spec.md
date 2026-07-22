# Nooka Fitness Coach — Phase Spec (PARKED: build after Receipt Scanner)

**Positioning:** "From kitchen to health." Nooka becomes the only app where your macros, meal plan, grocery list, budget, and pantry are one system. MyFitnessPal tells you numbers; Nooka cooks them.

**Non-negotiable architecture principle:** All numbers come from a deterministic math engine (`macroEngine.js`). Claude NEVER calculates calories, macros, TDEE, or rates. Claude only: (a) selects foods/recipes to hit computed targets, (b) writes coaching summaries FROM computed numbers passed in the prompt. This is what makes progress real and auditable.

---

## What already exists (extend, don't rebuild)

- `Member`: age, weight, weightUnit, height (string, e.g. `5'4"`), goals, dietary, allergens, dailyCalorieGoal, goalWeight, activityLevel
- `healthTrackerController.js`: Mifflin-St Jeor BMR, `ACTIVITY_MULTIPLIERS`, crude goal adjustment (−500 lose / +300 gain), %-based macro splits, 1200–4000 clamp
- `WeightLog`, `NutritionLog`, `NutritionCache` + AI lookup, `GrowthLog` (kids)
- `Health.jsx`: member tabs, 7-day calorie bars, streaks, weight history list, log weight/meal modals, Set Goals modal
- API layer: `src/api/healthTracker.js`

## Known issues to fix first

1. **BMR height bug:** female/missing-height branch in `calculateCalories` drops the `6.25 × heightCm` term entirely — verify and fix.
2. **Height is a display string** (`5'4"`) — no canonical cm conversion utility exists. Needed everywhere.
3. **Protein as % of calories** is wrong for bodybuilders — must be g/kg bodyweight.
4. **Weight history is raw points** — daily fluctuation (water, sodium, glycogen) misleads users. Need smoothed trend.

---

## The Math Engine (spec for `src/services/macroEngine.js`)

All pure functions, no DB access. Unit-testable with a local node script.

### 1. Canonical units
- `heightToCm(heightStr)` — parses `5'4"`, `64`, `163cm`, `163` → cm. Returns null if unparseable.
- `toKg(weight, unit)` — lbs → kg (÷ 2.2046).

### 2. BMR — Mifflin-St Jeor (requires sex field, see schema)
- Male: `10W + 6.25H − 5A + 5`
- Female: `10W + 6.25H − 5A − 161`
- If sex unknown: average of both, flag `confidence: 'low'`.

### 3. TDEE
- `formulaTdee = BMR × ACTIVITY_MULTIPLIERS[level]` (existing map).
- `effectiveTdee = adaptiveTdee ?? formulaTdee` — adaptive estimate always wins once available (see §6).

### 4. Goal engine (replaces flat −500/+300)
Goals: `cut` | `lean_bulk` | `recomp` | `maintain`. User picks a **rate**, not a calorie number:

| Goal | Rate options (% bodyweight/week) | Daily adjustment |
|---|---|---|
| cut | −0.25% / −0.5% / −0.75% / −1.0% | `−(rateKg × 7700 / 7)` kcal |
| lean_bulk | +0.1% / +0.25% / +0.4% | `+(rateKg × 7700 / 7)` kcal |
| recomp | 0 | TDEE, high protein |
| maintain | 0 | TDEE |

Where `rateKg = weightKg × ratePct`. 7700 kcal ≈ 1 kg of tissue.

**Safety floors:** never below `BMR × 1.05`; never below 1200 (F) / 1500 (M) kcal. If floor kicks in, cap the promised rate and tell the user honestly.

### 5. Macros (g/kg — bodybuilder credibility)
- **Protein:** cut → 2.2 g/kg; recomp → 2.0; lean_bulk → 1.8; maintain → 1.6. (If goalWeight set and cutting, use goalWeight as the multiplier base to avoid overshooting on high-BF users.)
- **Fat:** minimum 0.7 g/kg (hormonal floor); default 25% of calories, whichever is higher.
- **Carbs:** remainder. `(calories − protein×4 − fat×9) / 4`.
- **Fiber:** 14 g per 1000 kcal (ties into the fiber-goal item already on the horizon list).

### 6. Adaptive TDEE (the killer feature — real data, not formulas)
Every recalibration window (14 days):

```
avgIntake   = mean(daily logged calories, days with ≥1 meal logged)
trendDelta  = trendWeight(today) − trendWeight(14 days ago)   // kg, smoothed
adaptiveTdee = avgIntake − (trendDelta × 7700 / 14)
```

**Data quality gates** (else keep formula TDEE, show "log more to unlock adaptive targets"):
- ≥ 10 of 14 days with meals logged
- ≥ 4 weigh-ins in the window
- avgIntake > 800 kcal (guards against partial logging)

**Blending:** first valid window → `0.5 × formula + 0.5 × adaptive`. Subsequent windows → `0.25 × previous + 0.75 × new` (EMA, resists one bad fortnight). Clamp adaptive to ±25% of formula TDEE (guards against logging fantasy).

### 7. Trend weight (smoothing)
Exponentially weighted moving average over weigh-ins: `trend = trend + 0.25 × (weight − trend)`, seeded at first log, computed per-entry in kg. Weekly velocity = slope of trend over last 7 days. This is what charts and the audit use — raw weights shown as dots, trend as the line.

### 8. Weekly audit (deterministic diagnosis → AI writes it up)
Computed server-side:
- `adherence` = days logged / 7, and avg intake vs target (± %)
- `velocity` = trend kg/week vs goal rate
- `proteinHitRate` = days protein within 90% of target
- Verdict enum: `on_track` | `under_eating` | `over_target` | `plateau` | `insufficient_data`

**Plateau rule:** cut goal + adherence ≥ 80% + |velocity| < 0.1 kg/wk for 3 consecutive weeks → verdict `plateau` → deterministic options: (a) drop target 100 kcal, (b) 1-week diet break at maintenance, (c) +15 min daily steps. AI explains; math decides.

Claude Haiku turns the computed JSON into 3 sentences of coaching (strict raw-JSON system prompt per CLAUDE.md pattern). Cache per member per week like DailySuggestion.

### 9. Age safety (family app — this is a differentiator, not a limitation)
- `age < 18`: NO cut/deficit goals ever. Only `maintain`/growth. Hide rate pickers. Kids keep existing kids-summary flow.
- `isBaby`: untouched, existing baby flow.
- Pregnant/breastfeeding flag (future): block deficits, add +300/+500 kcal.

---

## Deep Nooka integration (why people pick Nooka over MacroFactor)

1. **Recipe generation gets targets injected:** every AI recipe prompt for a member includes `{calories remaining today, protein remaining, goal}` + pantry. "High-protein dinner from what's in your pantry that fits your remaining 640 kcal / 42 g protein."
2. **Meal plan generation** distributes weekly macro targets across the plan; grocery list inherits it — "this week's groceries hit everyone's targets under budget" (post-Receipt-Scanner, add cost-per-gram-of-protein — nobody else has this).
3. **Dashboard dinner card** becomes goal-aware for the primary member.
4. **Cooked meal → auto NutritionLog** using `nutritionPerServing` already on SavedRecipe (check if this hookup exists; if not it's Step 6 — logging friction is the #1 adherence killer and Nooka can log meals automatically because it knows what you cooked).

## Feature gating — PREMIUM ONLY

The entire Fitness Coach is a **Premium** feature. This fits the gating philosophy (weekly AI audits + goal-aware recipe generation are heavy AI features) and gives Premium a headline selling point: "MacroFactor charges $12/mo for adaptive TDEE alone — Nooka Premium includes it plus meal plans that cook your macros."

- **Free / Family:** existing Health tracker unchanged (manual weight/meal logging, legacy static calorie targets). Zero behavior change.
- **Premium:** everything in this spec — sex/goal/rate selection, g/kg macros, trend chart, adaptive TDEE, weekly AI audit, plateau protocol, goal-aware recipe and meal-plan generation.
- Single FeatureFlag: `fitness_coach` (requiredPlan `premium`).
- **Upsell surface:** Free/Family users see the goal pills and targets card in a locked state with the standard premium-lock UX — the locked preview IS the conversion funnel. Under-18 rule still applies on top of the plan gate.

---

## Build order — Claude Code session prompts

One session per step. Backend steps 0–5 deploy before frontend steps 6–7. Git flow per repo as usual (individual commands, no chaining). Schema via Supabase SQL Editor → `npx prisma generate` — never `prisma migrate dev`.

### Step 0 — Backend: units utility + BMR bug fix
```
Read CLAUDE.md, then read src/controllers/healthTrackerController.js.

Create src/services/units.js with two pure functions:
- heightToCm(heightStr): parse formats 5'4", 5'4, 64 (inches if <96 and no unit... treat bare numbers ≤96 as total inches, >96 as cm), "163cm", "163". Return Number or null.
- toKg(weight, unit): convert lbs to kg (divide by 2.2046), pass kg through. Return Number or null.

Then audit calculateCalories in healthTrackerController.js: the branch used when height is missing or member is female appears to drop the 6.25 × heightCm term from Mifflin-St Jeor. Fix so both sexes use the full formula via heightToCm; if height unparseable, use population-average height (170cm) and note lower confidence in a code comment. Do not change any other behavior. Refactor the controller to import from src/services/units.js.

Write a local test script scripts/test-units.js that asserts heightToCm on 8 formats and prints PASS/FAIL. No test framework, plain node.
```

### Step 1 — Schema (Supabase SQL Editor, then prisma)
Run in SQL Editor:
```sql
ALTER TABLE "Member"
  ADD COLUMN IF NOT EXISTS "sex" TEXT,
  ADD COLUMN IF NOT EXISTS "fitnessGoal" TEXT,
  ADD COLUMN IF NOT EXISTS "goalRatePct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "tdeeEstimate" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "tdeeUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tdeeConfidence" TEXT;

CREATE TABLE IF NOT EXISTS "WeeklyAudit" (
  "id" TEXT PRIMARY KEY,
  "memberId" TEXT NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE,
  "weekStart" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "verdict" TEXT NOT NULL,
  "coachSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("memberId", "weekStart")
);
```
Then locally: mirror the fields in `schema.prisma` (Member additions + WeeklyAudit model with relation) and run `npx prisma generate`. Enable RLS on `WeeklyAudit` to match the other tables. Add a single FeatureFlag row `fitness_coach` (requiredPlan `premium`) via SQL.

### Step 2 — Backend: the math engine
```
Read CLAUDE.md, then read src/controllers/healthTrackerController.js and src/services/units.js.

Create src/services/macroEngine.js — pure functions only, no prisma, no side effects:

1. bmr({weightKg, heightCm, age, sex}) — Mifflin-St Jeor; sex 'male'|'female'; if sex missing return average of both with confidence 'low'.
2. formulaTdee(bmrValue, activityLevel) — reuse the existing ACTIVITY_MULTIPLIERS map (move it into this file and re-export; update the controller import).
3. goalCalories({tdee, weightKg, fitnessGoal, goalRatePct, sex, bmrValue}) — goals: cut, lean_bulk, recomp, maintain. Daily adjustment = weightKg * goalRatePct * 7700 / 7, negative for cut, positive for lean_bulk, zero otherwise. Enforce floors: max(BMR*1.05, sex==='female'?1200:1500). Return {calories, flooredRatePct} where flooredRatePct is the actual achievable rate if the floor capped it, else goalRatePct.
4. macroTargets({calories, weightKg, goalWeightKg, fitnessGoal}) — protein g/kg: cut 2.2 (use goalWeightKg as base if provided and lower than weightKg), recomp 2.0, lean_bulk 1.8, maintain 1.6. Fat = max(0.7*weightKg, calories*0.25/9) grams. Carbs = (calories − protein*4 − fat*9)/4, floor at 0. Fiber = round(14 * calories/1000). Return {protein, fat, carbs, fiber} in grams, rounded.
5. trendWeights(logs) — logs sorted ascending [{weightKg, loggedAt}]; EWMA alpha 0.25 seeded at first entry; return array with trendKg per entry.
6. weeklyVelocity(trendSeries) — kg/week from linear fit over entries in the last 7 days; null if <2 entries.
7. adaptiveTdee({dailyIntakes, trendStartKg, trendEndKg, windowDays}) — dailyIntakes = array of daily calorie totals for days that have logs. Gates: dailyIntakes.length >= 10, avg > 800, else return null. Formula: avg(dailyIntakes) − ((trendEndKg − trendStartKg) * 7700 / windowDays).
8. blendTdee({previous, fresh, formula}) — if no previous: 0.5*formula + 0.5*fresh. Else 0.25*previous + 0.75*fresh. Clamp result to [0.75*formula, 1.25*formula].
9. auditWeek({daysLogged, avgIntake, targetCalories, velocityKgWk, targetVelocityKgWk, proteinHitDays, fitnessGoal, priorPlateauWeeks}) — return {adherencePct, intakeDeltaPct, verdict} with verdict one of on_track, under_eating, over_target, plateau, insufficient_data. Plateau: fitnessGoal==='cut' && adherencePct>=80 && Math.abs(velocityKgWk)<0.1 && priorPlateauWeeks>=2.

Age rule: export isEligibleForGoal(age, fitnessGoal) — under 18 only 'maintain'.

Then update calculateCalories/getMacroTargets in healthTrackerController.js to delegate to macroEngine when member.fitnessGoal is set, keeping the existing legacy path for members without one (backward compatible — no behavior change for current users).

Write scripts/test-macro-engine.js with plain-node assertions: 80kg male 180cm 30y moderate cutting at 0.5%/wk should land near 2280 kcal target with 176g protein; adaptiveTdee with 14 intakes of 2200 and 0.9kg trend loss over 14 days ≈ 2695. Print PASS/FAIL per case.
```

### Step 3 — Backend: goal endpoints + recalibration cron
```
Read CLAUDE.md, then read src/services/macroEngine.js, src/routes/healthTracker.js, src/controllers/healthTrackerController.js, and the existing cron setup used for the activation email.

1. Extend PUT /health-tracker/goal to accept sex, fitnessGoal, goalRatePct, goalWeight. Validate with isEligibleForGoal (reject deficit goals for under-18 with a clear error message). Gate fitnessGoal writes behind the fitness_coach feature flag (premium) using the existing flag-check pattern.
2. New GET /health-tracker/targets/:memberId — returns the full computed breakdown: {bmr, formulaTdee, effectiveTdee, source: 'formula'|'adaptive', confidence, calories, flooredRatePct, macros, trendWeightKg, weeklyVelocity}. Everything from macroEngine; no AI.
3. Weekly cron (same registration pattern as activation email, run Sundays 6am Vancouver time): for each member with fitnessGoal set whose family has fitness_coach (premium) access — build the 14-day window (daily NutritionLog totals, WeightLog trend via trendWeights), call adaptiveTdee, blend with blendTdee, write tdeeEstimate/tdeeUpdatedAt/tdeeConfidence ('adaptive' when gates pass, 'formula' otherwise) on Member.
4. Include effectiveTdee-derived targets in the getHealthData response so the frontend gets them in the existing single call.

No frontend changes in this session.
```

### Step 4 — Backend: weekly audit + AI coach summary
```
Read CLAUDE.md, then read src/services/macroEngine.js and whichever controller builds the cached Dashboard dinner suggestion (DailySuggestion) — follow its caching pattern.

1. In the Sunday cron after recalibration: compute auditWeek inputs per member from real data (days logged, avg intake, protein hit days = days within 90% of protein target, weeklyVelocity from trend, target velocity from goalRatePct). Persist to WeeklyAudit (metrics JSONB, verdict).
2. If verdict is plateau, metrics must include the three deterministic options: dropCalories: 100, dietBreakDays: 7 at effectiveTdee, extraStepsMinutes: 15.
3. Generate coachSummary with Claude Haiku. System prompt must follow the CLAUDE.md raw-JSON pattern. User prompt contains ONLY the computed metrics JSON and verdict — never the member's name (CLAUDE.md no-PII rule). Instruct the model to use the literal placeholder `{{name}}` wherever it would address the member, 3 sentences max, warm but direct tone, no numbers not present in the input. After parsing, replace all `{{name}}` occurrences with the member's first name server-side before storing. Apply the same `{{name}}` placeholder and server-side substitution to the deterministic fallback strings. On parse failure store the substituted fallback for the verdict.
4. GET /health-tracker/audit/:memberId — latest WeeklyAudit, gated behind the fitness_coach flag.
5. Track API cost with the existing per-model cost tracking.
```

### Step 5 — Backend: goal-aware recipe generation
```
Read CLAUDE.md, then read the recipe generation controller (the one used by pantry recipe generation and the Dashboard dinner card) and src/services/macroEngine.js.

For members with fitnessGoal set: compute today's remaining budget (targets minus todayTotals from NutritionLog) and inject one short block into the existing recipe prompt: "This meal should provide roughly {remainingCalories/mealsRemaining} kcal and at least {remainingProtein/mealsRemaining}g protein for {name}, who is on a {fitnessGoal} plan." Do not restructure the prompt otherwise; keep pantry-native units and all existing constraints. Skip injection entirely when no fitnessGoal (zero behavior change for existing users). Gate behind the fitness_coach flag — since only premium families can set fitnessGoal, the field itself is effectively the gate, but check the flag anyway for safety on downgraded accounts.

Also check: when a meal plan recipe is marked cooked, do we auto-create NutritionLog rows from nutritionPerServing for the members who ate it? If not, add that in this session — it is the highest-leverage adherence feature we have (automatic logging). If nutritionPerServing is missing on the recipe, skip silently.
```

### Step 6 — Frontend: goal setup + targets UI (after backend deployed)
```
Read CLAUDE.md, then read src/pages/Health.jsx, src/api/healthTracker.js, src/pages/Settings.jsx (pill selector patterns), and src/components/ui/Onboarding.jsx.

1. Extend the Set Goals modal in Health.jsx: sex selector (pill, 'Prefer not to say' allowed), fitness goal pills (Cut / Lean bulk / Recomp / Maintain), and when cut or lean_bulk is selected a rate picker as pills labeled in plain language: Cut → Relaxed −0.25%/wk, Steady −0.5%/wk, Aggressive −0.75%/wk, Rapid −1%/wk; Lean bulk → Slow +0.1%, Steady +0.25%, Fast +0.4%. Under-18 members: show only Maintain with a short note. Wire to updateMemberGoal.
2. New targets card at top of the member view: calories + protein/carbs/fat/fiber grams, a small line 'Based on your real data' when source==='adaptive' vs 'Estimated — log meals and weight to unlock adaptive targets' when formula. If flooredRatePct differs from goalRatePct, show the honest cap message.
3. Weight tab: render trend line over raw dots using the existing chart approach in the codebase (check what Health.jsx or Dashboard uses for the consistency dots/last7Days bars; if there is no chart lib, build a small inline SVG line — do not add a chart library). Show weekly velocity ('−0.4 kg/wk') next to goal rate.
4. New audit card: coachSummary text, verdict pill, and when plateau the three options as buttons — Drop 100 kcal calls updateMemberGoal; the others are informational for now. AI elements use the bubble Icon.jsx variant per convention.
5. The ENTIRE feature is premium (fitness_coach flag). For Free/Family users render the goal pills and targets card in the standard locked/upsell state used by other premium features — visible but locked, tapping opens the upgrade flow. The legacy Health tracker keeps working for them unchanged. Use existing card/pill/btn classes throughout.
```

### Step 7 — Frontend: onboarding + dashboard touchpoints
```
Read CLAUDE.md, then read src/components/ui/Onboarding.jsx and the Dashboard dinner card component.

1. Onboarding member step: add the sex + fitness goal pills (adults only) after activity level, same pill component, optional/skippable.
2. Dashboard dinner card: when the primary member has fitnessGoal and fitness_coach (premium) access, show one line under the suggestion: '{protein}g protein · fits {name}'s {goal} plan' using data already returned by getHealthData — no new API call.
```

### Step 8 — Mobile parity (later, after web verified)
Web files are the reference: `Health.jsx` targets card + goal modal + trend chart → `familypantry-mobile` equivalents. Push-notification hook: weekly audit ready → Expo push (reuse PushToken infra).

### Phase 2 — parked further (build only if Phase 1 engagement is strong)
- Workout split generator (Premium): Claude generates a PPL/UL template ONCE per goal as structured JSON, stored like SavedRecipe; simple set/rep/weight logging; deterministic progressive-overload check (did top-set weight or reps increase vs last session → flag). No exercise video library — link out.
- Supplement evidence card: static curated content (creatine/protein/caffeine/vit D), not AI-generated. Skip everything else from the original prompt list (#4 sleep, etc.) — out of scope drift.

---

## Success metrics
- % of adult members who set a fitnessGoal within 7 days of signup
- Meal-logging days/week before vs after goal set (adherence lift)
- % of goal-setters reaching adaptive TDEE (data-quality gates passed) — this is the retention moat: leaving Nooka (or downgrading) means losing your calibrated TDEE
- Free/Family → Premium conversion attributed to `fitness_coach` locked-card taps (track the upsell impressions vs upgrades)
- Premium churn among members with an active fitnessGoal vs without — the coach should measurably reduce churn

## Marketing hooks (feed the 8-week playbook)
- SEO page: "Macro calculator for Canadian families" → funnels into signup
- The honest-math angle: "Your fitness app guesses your calories once. Nooka recalculates from your real weigh-ins every two weeks."
- Bodybuilder Reddit angle: g/kg protein, EWMA trend weight, adaptive TDEE — the vocabulary that r/fitness respects.
