# DreamTrace web deployment

The Runpod endpoints and Supabase project are independent of the web host. Vercel runs
the Next.js application and its durable workflow functions; Supabase owns authentication,
private data, and storage; Runpod performs GPU inference.

Current public domain: [dreamtrace.vercel.app](https://dreamtrace.vercel.app)

## Project configuration

The Vercel project is `dreamtrace`. For a fresh setup, create it once with:

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Framework | Next.js |
| Production branch | `main` |
| Node.js | 24.x |
| Install command | detected from `pnpm-lock.yaml` |
| Build command | `pnpm build` |

Do not deploy the repository root as the web project. The root Dockerfile belongs to
the custom Runpod worker.

The first release uses the Vercel CLI because the Vercel GitHub App is not authorized for
this repository. The repository root is linked locally in `.vercel`; Vercel's project
Root Directory remains `web`. Do not import the repository again or deploy with
`--cwd web`, because either would bypass or duplicate that root-directory relationship.

## Production environment

Use one of three explicit Preview scopes. A build-only Preview has no variables. A
page/session Preview has only isolated Preview values for the two public Supabase
variables. A full API/GPU Preview has a separate Supabase project plus all server-only
credentials except `CRON_SECRET`, plus its own Runpod budget. Give a cron test Preview a
different secret only when testing that route. Never point a Preview at Production data
merely to make a browser check pass.

Production requires:

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `RUNPOD_API_KEY` | sensitive | Submit and inspect GPU jobs |
| `RUNPOD_ENDPOINT_ID` | server-only | Custom FLUX.1-dev anchor worker |
| `RUNPOD_PLANNER_ENDPOINT_ID` | server-only | Qwen story planner |
| `RUNPOD_KONTEXT_ENDPOINT_ID` | server-only | Coherent scenes and branches |
| `RUNPOD_WHISPER_ENDPOINT_ID` | server-only | Voice transcription |
| `SUPABASE_SECRET_KEY` | sensitive | Server-side workflow persistence |
| `NEXT_PUBLIC_SUPABASE_URL` | public by design | Browser Supabase connection |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design | RLS-scoped anonymous access |
| `CRON_SECRET` | sensitive | Authenticate the daily audio-cleanup recovery sweep |

Never set `HF_TOKEN` in Vercel. It belongs only in Runpod's gated cached-model
configuration. Never prefix either secret with `NEXT_PUBLIC_`.

## Preflight

1. Confirm anonymous sign-ins are enabled for the intended Supabase project.
2. Confirm local and remote migration versions match exactly.
3. Run schema lint against the linked project.
4. Run the web gate in order.

```bash
supabase migration list --linked
supabase db lint --linked --level error
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web lint
pnpm --dir web build
```

Do not submit a paid GPU smoke request until the production URL passes page and
anonymous-session checks.

## Release procedure

1. Push a reviewed commit and merge only after GitHub CI passes.
2. Because this project is not Git-connected, check out the merged `main` commit and
   require `git status --porcelain` to be empty.
3. Confirm all Production variables exist by name in Vercel.
4. Stage the reviewed commit without moving the Production domain:
   `npx vercel --prod --skip-domain` from the repository root.
5. Open that exact staged URL in a private browser window, confirm an anonymous session
   enables both capture modes, and submit one prepared text dream. Verify the durable run,
   three private images, journal entry, and one idempotent scene branch.
6. Only after staged acceptance passes, run
   `npx vercel promote <deployment-url>` from the repository root.
7. Confirm the Production domain serves the same commit and creates its own anonymous
   session. The staged anonymous journal is intentionally hostname-scoped and does not transfer.
8. In the Production presentation session, create the prepared text dream and its scene
   branch so the fallback evidence exists under the real hostname.
9. Submit one prepared voice dream and verify upload, transcription review, generation,
   and a pending cleanup workflow. Confirm source-audio deletion after the two-hour
   signed-upload lifetime plus the cleanup grace window.
10. Confirm `/api/internal/audio-cleanup` appears under Vercel Cron Jobs. Trigger one
   authenticated manual run from Vercel and capture its response or log separately from
   the first scheduled invocation. Vercel does not retry a failed cron invocation.
11. For the presentation window, confirm one active worker on the owned planner, FLUX,
    and Whisper endpoints. After the interview, set their minimums back to zero if warm
    demo latency is no longer required.

If Git is connected later, use a fully isolated Preview for staged acceptance before
merging; merging `main` then publishes Production automatically and replaces steps 2–6.

## Rollback

For a CLI-based first release, do not promote a failing `--skip-domain` deployment; fix
it and deploy a new reviewed commit. A Git-connected merge already targets the
Production domain, so repair it with a reviewed follow-up deployment. After a known-good
release exists, promote that exact deployment or use Vercel rollback.

Database migrations must remain forward-compatible; do not reverse them as part of a
web rollback. Durable workflow runs remain pinned to the deployment that started them,
so rollback does not stop existing work. Leave audio-cleanup runs active because they
protect private source recordings and do not submit Runpod jobs. For generation,
transcription, or branch runs, inspect or cancel the exact Vercel Workflow run, reconcile
its stored claim, and only then inspect the exact recorded Runpod job. Never issue a blind
replacement request.

Vercel Instant Rollback does not move active cron jobs. After rollback, inspect the
registered audio-cleanup cron separately and update or disable it only if its target is
incompatible; do not cancel already-running cleanup workflows.

## Cleanup recovery schedule

The project is on Vercel Hobby, so `web/vercel.json` schedules the authenticated recovery
sweep once daily. Hobby runs `17 4 * * *` sometime during 04:00–04:59 UTC rather than at
an exact minute. Each upload also starts its own durable cleanup workflow, which normally
acts at the two-hour token expiry plus a five-minute grace period. The daily cron is only
for failed or interrupted workflow reconciliation; duplicate invocations are safe because
database claims serialize ownership. Processing still active six hours after token expiry
is failed and released for deletion so a lost transcription cannot retain audio forever.

## Evidence to capture

- Production URL and deployed Git commit.
- Green GitHub and Vercel build checks.
- Redacted workflow run stages and Runpod timings.
- One text result, one voice result, and one selected branch.
- Final zero-worker state and total credit spend.

Do not capture API keys, signed image URLs, anonymous user IDs, or worker environment
objects in screenshots or logs.

The latest acceptance record is maintained in [EVIDENCE.md](EVIDENCE.md).
