# DreamTrace product runbook

## Outcome

DreamTrace turns a remembered dream into a private, coherent visual story. A user can
type or record the memory, review the transcript, generate one to six connected scenes,
optionally appear in every scene through a private Dream Self photo, choose an
illustration style, revise one scene, select the preferred version, and revisit recurring
motifs across completed dreams.

The product extension keeps the required case-study endpoint independently visible and
uses it for scene one whenever no Dream Self is attached. Identity-aware stories use
Runpod's public Kontext model from scene one onward because it accepts the private image
reference. Runpod also hosts the planner and downstream image/edit workload, so the app
demonstrates orchestration, failure recovery, and cost controls rather than hiding the
GPU platform behind one API call.

## Components

| Component | Responsibility |
| --- | --- |
| Next.js app | Capture, transcript review, story UI, scene editing, journal |
| Durable workflows | Submit once, poll, persist, retry safely, cancel on local timeout |
| Qwen3-4B-AWQ endpoint | Strict JSON story plan, moods, motifs, and one to six prompts |
| Custom FLUX.1-dev endpoint | Anchor image from the accepted gated model |
| FLUX.1 Kontext endpoint | Coherent scenes and instruction-based branches |
| Whisper endpoint | Voice transcription for the default capture mode |
| Supabase | Anonymous auth, RLS data model, private audio/image storage |
| Dream Self normalizer | Bounds pixels, removes metadata, and prepares a private identity PNG |

## Privacy and correctness boundaries

- The browser gets an anonymous Supabase user; every journal table and object path is
  scoped to that identity through RLS.
- Transcripts, prompts, images, and tokens are not written to application logs.
- A generation job stores model, endpoint ID, stable request hash, provider job ID,
  state, timings, and cost provenance.
- Provider request hashes use stable storage identities, not expiring signed URL bytes.
- Private story links are renewed ten minutes before their one-hour expiry. Rapid workflow
  polls preserve the current URL to avoid image flicker; renewal polls replace it.
- Dream Self consent is versioned and recorded. New stories cannot use an expired
  reference; the original upload is deleted after normalization, and provider links last
  15 minutes.
- Photo replacement is commit-before-deactivate. Manual deletion, expiration, and a
  delayed tombstone sweep cover source, normalized, and late-race objects.
- Branch workflow claims prevent replayed API requests from starting duplicate durable
  workflows.
- Atomic database counters cap each journal at two active dreams, six new dreams, and 12
  scene edits per UTC hour. Each story conservatively reserves eight Runpod job slots and
  each edit reserves one from a durable 100-slot global UTC-day ceiling. Dream Self has
  separate six-per-hour and 40-per-day preparation limits, with at most two pending.
  Idempotent replays are checked before quota reservation and never consume twice.
- Failed or cancelled scene edits are terminal and can be retried with a new operation;
  an unknown submission outcome stops polling and is never blindly resubmitted.
- Catchable failures atomically release the matching workflow claim or run while the
  branch is pending. Request-time reconciliation also checks Vercel Workflow status and
  reclaims only missing, failed, or cancelled runs; active work remains untouched.
- Audio preparation binds a per-recording idempotency key to one MIME type and private
  path. Upload tokens cannot overwrite an existing object, and ambiguous retries verify
  idempotent completion before requesting a fresh token.
- A recovery-aware durable workflow removes abandoned drafts and source audio after the
  signed upload token expires. This avoids deleting an object while an older upload token
  could still recreate it.
- An authenticated daily maintenance sweep reconciles due cleanup work whose durable run
  is missing, failed, cancelled, or completed without recording its final database step.
  The per-upload workflow remains the normal two-hour cleanup path; the sweep is a safety net.
- Uploads or transcriptions that remain active six hours beyond token expiry are marked
  failed, their exact durable run is cancelled when possible, and cleanup can proceed.
- An ambiguous paid submission is never blindly repeated. If its external ID is later
  recovered, the job and scene version recover transactionally.
- Provider result downloads accept only approved HTTPS Runpod image hosts and revalidate
  every redirect before bounded PNG ingestion.
- At the local poll deadline, DreamTrace asks Runpod to cancel the exact queued/running
  job. A confirmed completion is still persisted; an uncertain cancellation remains a
  manual-reconciliation case rather than being mislabeled safe to retry.

## Environment

Copy `.env.example` to the ignored root `.env` and set:

- `RUNPOD_API_KEY`
- `RUNPOD_ENDPOINT_ID` for the custom FLUX worker
- `RUNPOD_PLANNER_ENDPOINT_ID` for Qwen3-4B-AWQ
- `RUNPOD_KONTEXT_ENDPOINT_ID`
- `RUNPOD_WHISPER_ENDPOINT_ID` for the default voice capture mode
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `CRON_SECRET` for the authenticated Vercel maintenance route

Never commit these values. The Hugging Face token belongs in Runpod's gated cached-model
configuration, not the web application.

## Planner endpoint settings

The Qwen planner remains capped at one worker. During the interview window it keeps one
active worker with a 300-second idle timeout and prioritizes the 16 GB RTX A4000 tier.
Qwen3-4B-AWQ fits comfortably there, and the abundant right-sized tier avoided measured
4090 host throttling. The custom FLUX and Whisper endpoints also keep one active worker
for presentation reliability. Return all three minimums to zero after the interview if
scale-to-zero behavior is preferred.

## Local run

From the repository root:

```bash
set -a
source .env
set +a
pnpm --dir web install --frozen-lockfile
pnpm --dir web dev
```

Apply database changes from the repository root after linking the intended Supabase
project:

```bash
supabase migration list --linked
supabase db push --linked
supabase db lint --linked --level error
```

The migration list is part of the safety check. Do not push to a project whose remote
history does not match the local prefix.

## Verification

Run checks in this order:

```bash
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web lint
pnpm --dir web build
```

The linked-database test creates disposable anonymous users and tiny artifacts, exercises
atomic claim/run recovery, verifies workflow exclusivity, stale-audio expiry, one-branch
enforcement, and foreign-user isolation, then removes its fixtures:

```bash
pnpm --dir web test:db:branch-recovery:linked
```

The separate quota fixture verifies concurrent mixed text/audio admission, idempotent
replay without double charging, stale-workflow protection, active and hourly ceilings,
and durable usage counters:

```bash
pnpm --dir web test:db:quotas:linked
```

## Paid end-to-end demo seed

The opt-in seeder creates persistent demo journal rows under its own anonymous session.
It performs two planner calls, one image job per planned scene, and one scene branch.
It does not delete successful demo rows. It also replays branch creation and selection
to verify idempotency, and rejects `READY` unless each dream has one to six contiguous
scenes with exactly one selected completed image apiece.

With the app already running:

```bash
DREAMTRACE_DEMO_SEED=1 DREAMTRACE_BASE_URL=http://localhost:3000 \
  pnpm --dir web demo:seed
```

Use this only when the endpoint budget and intended Supabase project have been checked.
Ordinary unit, build, and database-recovery tests do not call a GPU.

## Paid voice acceptance

The opt-in voice client exercises signed upload, upload-completion replay, Runpod Whisper,
transcript review, transcript-confirmation replay, and the adaptive image workflow. The
audio file may be OGG, MP4, or WebM and must be at most 10 MB.

```bash
DREAMTRACE_VOICE_SMOKE=1 DREAMTRACE_BASE_URL=https://dreamtrace.vercel.app \
  DREAMTRACE_AUDIO_PATH=/absolute/path/to/dream.ogg DREAMTRACE_AUDIO_MIME=audio/ogg \
  pnpm --dir web demo:voice
```

The successful journal remains under the smoke client's anonymous session, and source
audio remains private until its durable cleanup deadline.

## Live evidence

The promoted adaptive release has produced:

- one selected image for a continuous single-setting, single-action dream;
- six contiguous selected images for a dream with six explicit setting/action changes;
- two ordinary three-scene dreams sharing a silver train, brass key, red fox, and
  moonlit lake;
- a completed and selected scene-two branch, including idempotent creation and selection
  replay;
- a three-scene watercolor story with one consistent synthetic Dream Self;
- a verified `DELETED` identity tombstone with private paths and content hash cleared;
- a Runpod Whisper transcript followed by a complete voice story and accepted upload plus
  transcript replays without duplicate workflows;
- provider-reported Kontext timings and cost where available.

The first single-moment acceptance run produced three repetitive images. Tightening the
planner to add a scene only for a meaningful transition fixed that measured failure; the
same staged artifact then passed both one- and six-scene boundaries before promotion.

A post-idle planner job previously remained queued while a 4090 worker was throttled and
reached the local cancellation deadline. Prioritizing an active A4000 worker removed that
capacity bottleneck; subsequent text, identity, and voice workflows completed normally.

Exact job IDs and measured timings belong in redacted presentation evidence, not source
code, because endpoint history and anonymous journal IDs are operational data.

## Web deployment

The Runpod endpoints, Supabase schema, durable workflows, and public Vercel application
are live. Follow [WEB_DEPLOYMENT.md](WEB_DEPLOYMENT.md) for the environment boundaries,
release sequence, acceptance test, and rollback procedure.
