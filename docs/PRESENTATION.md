# DreamTrace live presentation runbook

## Before the call

- Confirm credits and endpoint health.
- Keep Max workers at 1. Warm only the endpoint needed for the live path; return Active
  workers to 0 afterward.
- Open the app, one completed two-dream journal, the Runpod endpoint pages, and redacted
  request evidence in separate tabs.
- Confirm a fresh text dream, a branch, and journal navigation in the exact browser
  session used for the presentation.
- Keep the last successful three-scene story and branch available as fallback evidence.
- Verify no terminal or browser view exposes API or Hugging Face tokens.

## Ten-minute flow

1. **Outcome — 45 seconds.** Open a finished dream. Explain: “I started with the required
   FLUX endpoint, then built a private visual dream journal around Runpod.”
2. **User flow — 90 seconds.** Enter a short dream, start generation, and switch to an
   already-completed story while the live job runs.
3. **Coherence — 60 seconds.** Show the three scenes and point out the shared palette,
   character, object, and setting carried from the anchor through Kontext.
4. **Interactive edit — 60 seconds.** Show the red-fox branch comparison and select the
   preferred scene without regenerating the other two.
5. **Memory over time — 45 seconds.** Open the constellation and show recurring motifs
   connecting two dreams.
6. **Architecture — 75 seconds.** Use the README diagram: browser, durable workflow,
   Supabase, Qwen planner, custom FLUX anchor, Kontext continuity/edit.
7. **Required endpoint — 75 seconds.** Show `handler.py`, one-time model load, bounded
   contract, cached gated weights, GitHub build, and the direct red-panda output.
8. **Reliability — 75 seconds.** Explain persisted endpoint/request identity, workflow
   claims, ambiguous-submission recovery, cancellation, RLS, and scale-to-zero.
9. **Evidence — 45 seconds.** Show typecheck, 54 web tests, 53 worker tests, production
   build, schema lint, live database recovery, and measured Runpod jobs.
10. **Return to outcome — 30 seconds.** Refresh the live dream if ready; otherwise keep
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
- **GPU unavailable:** show the queued state and the three enabled H100 variants.
- **Build regression:** roll back from Runpod's Builds tab and explain the release gate.
- **Live API issue:** show the last successful Runpod job, redacted JSON, image, and exact
  commit/release used. Never substitute an unverified claim.
- **App job still running:** show its durable status and continue with the prepared
  completed journal. Do not start a duplicate request.
- **Web deployment issue:** run the production-built app locally and state that public
  hosting is not part of the verified evidence yet.

## Likely questions

**Why not put the model in the image?** Runpod explicitly provides gated model caching;
it avoids credentials in image layers, a roughly 58 GB weight transfer, builder time,
the 80 GB image limit, and billed download time while preserving the exact revision in
responses.

**Why an 80 GB GPU?** The model card reports about 50 GB to load all components. This
keeps the reference BF16 pipeline on one GPU without offload or quantization tradeoffs.

**Why base64?** It is the smallest complete solution for a single bounded image. At
production volume, measure payloads and return an expiring object-store URL.

**How does it scale?** Runpod queues jobs and can add workers. This evaluation caps Max
workers at 1 for predictable spend; increasing it is an endpoint setting, but requires a
load and cost test first.

**Why more than one model?** FLUX creates the visual anchor, Qwen converts a nonlinear
memory into a strict plan, and Kontext preserves or edits an existing image. Each model
has one narrow, testable responsibility.

**What happens on retries?** The database claims a logical operation before submission.
Replays reuse the same workflow and provider job. If the submission response is
ambiguous, DreamTrace stops rather than risking a second paid image.

**Why anonymous auth?** It makes the demo immediate while still enforcing row and object
isolation. A production release would let the user link that identity to a permanent
account before cross-device access.

**What would you improve next?** First deploy and verify the web app publicly, then add a
small reconciliation dashboard for uncertain cancellations. After measuring real usage,
evaluate planner/FLUX quantization and account linking separately.
