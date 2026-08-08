# DreamTrace live presentation runbook

## Before the call

- Confirm credits and endpoint health.
- Keep Max workers at 1. Confirm one active worker on the owned planner, FLUX, and
  Whisper endpoints; Kontext is a Runpod-managed model endpoint.
- Open the app, one completed two-dream journal, the Runpod endpoint pages, and redacted
  request evidence in separate tabs.
- Confirm a fresh text dream, a branch, and journal navigation in the exact browser
  session used for the presentation.
- Keep the last successful adaptive story and branch available as fallback evidence.
- Verify no terminal or browser view exposes API or Hugging Face tokens.

## Eight-minute core flow

1. **Outcome — 30 seconds.** Open a finished dream. Explain: “I started with the required
   FLUX endpoint, then built a private visual dream journal around Runpod.”
2. **Required endpoint — 75 seconds.** Show `handler.py`, one-time model load, bounded
   contract, cached gated weights, the root Dockerfile, and the completed GitHub build.
3. **Direct endpoint result — 45 seconds.** Show the red-panda request, Runpod job, and
   generated 1024×1024 image before introducing the product extension.
4. **User flow — 75 seconds.** Open “Make it feel like yours,” show the private-photo
   disclosure and three illustration styles, then enter a short dream. Use a prepared,
   consented fixture photo for the live call and switch to a completed story while it runs.
5. **Identity and coherence — 60 seconds.** Show the adaptive number of moments. Point out
   the same recognizable dreamer plus the shared palette, symbols, and setting.
6. **Interactive edit — 45 seconds.** Show the red-fox branch comparison and select the
   preferred scene without regenerating the rest of the story.
7. **Memory over time — 30 seconds.** Open the constellation and show recurring motifs
   connecting two dreams.
8. **Architecture — 60 seconds.** Use the README diagram: browser, durable workflow,
   private Supabase identity, Qwen planner, custom FLUX anchor path, and Kontext identity,
   continuity, and edit paths.
9. **Reliability — 45 seconds.** Explain persisted endpoint/request identity, workflow
   recovery, ambiguous-submission handling, cancellation, RLS, and the API rate limit.
10. **Evidence — 30 seconds.** Show typecheck, 208 web tests, 53 worker tests, Production
   build, schema lint, live database recovery, one-/six-scene boundaries, and measured
   Runpod jobs.
11. **Return to outcome — 15 seconds.** Refresh the live dream if ready; otherwise keep
    the fallback story visible and show the queued/running request honestly.

## Direct endpoint fallback

```bash
uv run python scripts/invoke.py --sync --output artifacts/live-demo.png
```

If the synchronous request exceeds its wait window, switch to the default async command;
this is expected API behavior, not necessarily worker failure:

```bash
uv run python scripts/invoke.py --output artifacts/live-demo.png
```

## Failure recovery

- **Cold worker:** narrate the initialization logs and use the async request.
- **FLUX GPU unavailable:** show the queued state and the three enabled H100 variants.
- **Planner cold or throttled:** show endpoint health, do not submit a duplicate, and use
  the prepared journal. The presentation configuration keeps one A4000-class worker
  active with a one-worker ceiling because a primary 4090 allocation throttled.
- **Build regression:** roll back from Runpod's Builds tab and explain the release gate.
- **Live API issue:** show the last successful Runpod job, redacted JSON, image, and exact
  commit/release used. Never substitute an unverified claim.
- **App job still running:** show its durable status and continue with the prepared
  completed journal. Do not start a duplicate request.
- **Web deployment issue:** promote the last known-good Vercel deployment and use its
  matching prepared journal while investigating the failed release separately.

## Likely questions

**Why not put the model in the image?** Runpod explicitly provides gated model caching;
it avoids credentials in image layers, a roughly 58 GB weight transfer, builder time,
the 80 GB image limit, and billed download time while preserving the exact revision in
responses.

**Why an 80 GB GPU?** The model card reports about 50 GB to load all components. This
keeps the reference BF16 pipeline on one GPU without offload or quantization tradeoffs.

**Why base64?** It is the smallest complete solution for a single bounded image. At
production volume, measure payloads and return an expiring object-store URL.

**How does it scale?** Runpod queues jobs and can add workers. This evaluation caps each
owned endpoint at one worker because the workflow is intentionally sequential. Active
workers remove demo cold starts; a concurrent product load test would justify raising
the maximum independently per stage.

**Why more than one model?** FLUX creates the visual anchor, Qwen converts a nonlinear
memory into a strict plan, and Kontext preserves or edits an existing image. Each model
has one narrow, testable responsibility.

**Why does a photo story start with Kontext instead of the custom endpoint?** The custom
FLUX worker is text-to-image and remains the required direct endpoint plus the default
no-photo anchor. Kontext accepts the private reference image, so the identity path uses
it for every moment. That avoids training on a user photo and keeps deletion simple.

**Why not pass the previous scene and the face?** The selected public endpoint accepts one
image reference. Reusing the face prioritizes recognizability; the visual bible carries
palette, clothing, objects, and setting. A multi-reference adapter would be a separate
quality and privacy evaluation.

**What happens on retries?** The database claims a logical operation before submission.
Replays reuse the same workflow and provider job. If the submission response is
ambiguous, DreamTrace stops rather than risking a second paid image.

**Why anonymous auth?** It makes the demo immediate while still enforcing row and object
isolation. A production release would let the user link that identity to a permanent
account before cross-device access.

**What would you improve next?** Add completed-journal deletion and retention controls,
then a small reconciliation dashboard for uncertain cancellations and an account-linking
flow for cross-device journals. After measuring real usage, evaluate planner/FLUX
quantization separately.
