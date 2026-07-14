# CLAUDE.md — Nooka Backend (familypantry-backend)

## What this is
Nooka (nooka.ca) — AI meal planning, pantry tracking & nutrition app for Canadian families. This repo is the **API**: Node.js + Express + Prisma, deployed on **DigitalOcean App Platform** at api.nooka.ca. Database is **PostgreSQL on Supabase (Canada Central)**. Frontend is a separate repo (`~/Desktop/familypantry`, Vercel). Live product with paying users and real Stripe subscriptions — production changes must be deliberate.

## Workflow rules (always follow)
- **Read before writing.** Always read the relevant controllers/routes/jobs before proposing changes.
- **Plan → approval → code.** Show a plan or diff and wait for explicit approval before applying anything non-trivial.
- **One change at a time** unless asked for multiple.
- **Extend, don't rebuild.** Reuse existing helpers (`callClaude`, `trackApiUsage`, `handleAnthropicError`, `buildEmailWrapper`, existing expiry/pantry queries) instead of duplicating.
- After each completed step, remind me to git commit — and note that pushing `main` triggers the DigitalOcean redeploy.

## Git flow (exact, individual commands — never chained, no inline comments)
```
git add .
git commit -m "..."
git push origin dev
git checkout main
git merge dev
git push origin main
git checkout dev
```
Never commit `.env`, `.env.production`, or `.claude/`.

## Database & Prisma (critical)
- **NEVER run `prisma migrate dev`** — it fails against the Supabase connection pooler.
- Schema changes: write the SQL (`ALTER TABLE` / `CREATE TABLE`) for me to run manually in the **Supabase SQL Editor**, update `schema.prisma` to match, then remind me to run `npx prisma generate` locally. Wait for my confirmation before writing code that depends on the new schema.
- All queries scoped by `familyId` — every endpoint must enforce family scoping via the existing auth middleware. Never trust client-provided family/user IDs.

## Claude API conventions (critical)
- Model for main features: `claude-sonnet-4-6`. Cheap/ambient calls (pre-checks, cached daily suggestions): use haiku.
- **JSON responses:** Claude 4.6+ wraps JSON in markdown fences unless forced not to. Every JSON-parsing call MUST include a `system` prompt like: `'You are a [domain] API. Respond with only a valid raw JSON object. No markdown, no backticks. Start with { end with }.'` AND defensively strip ``` fences before `JSON.parse`.
- Always wrap calls with the existing `callClaude` helper and `trackApiUsage(endpointName)`; handle failures with `handleAnthropicError`. AI endpoints must degrade gracefully — never 500 the client because Anthropic errored.
- Never send PII (names, emails) to the Anthropic API — anonymized profiles only (Person A/B/C pattern), per our privacy policy.

## Plan gating philosophy
- Heavy AI features → Premium only. Smart zero-cost features → Family+. Basic → Free.
- Gating lives in the backend (controllers + Supabase `FeatureFlag` table, lookup key `name`). The frontend must never be the only enforcement.
- Existing examples: photo scan `SCAN_LIMITS = { free: 0, family: 5, premium: 999 }`; free recipes 5/week; weekly digest content varies by plan.
- Retention-critical basics (e.g. expiry reminders) stay free.

## Email (Resend)
- From addresses: `noreply@nooka.ca` (automated), `support@nooka.ca`.
- Reuse the `buildEmailWrapper` pattern from `src/jobs/weeklyDigest.js`: single column, inline styles only, max-width ~600px, mobile-friendly buttons (padding ≥ 12px 24px), unsubscribe token footer.
- Respect `digestEnabled` opt-out for all lifecycle emails. Cron jobs run in `America/Vancouver` timezone; wrap each family in try/catch so one failure doesn't kill the batch.

## Debugging (learned the hard way)
- **DigitalOcean logs are unreliable.** Debug via local node scripts using `.env.production`, direct file inspection with grep, and `git log` verification — not by waiting for DO logs.
- Health check: `GET https://api.nooka.ca/api/health` (UptimeRobot pings this).

## Structure conventions
- Routes in `src/routes/`, controllers in `src/controllers/`, cron jobs in `src/jobs/`, shared helpers in `src/utils/`.
- Rate limiting is configured in `src/index.js` (global / AI / admin tiers) — new AI endpoints go under the AI limiter. Large-body routes are explicitly whitelisted there.
- No new libraries unless truly necessary — propose first (e.g. use plain `fetch` for external APIs like Expo push).
