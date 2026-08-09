# Production acceptance evidence

Validated on August 8, 2026 PT against
[dreamtrace.vercel.app](https://dreamtrace.vercel.app). Credentials, signed URLs,
anonymous user IDs, and provider job IDs are intentionally omitted.

## Release identity

- The hardened application release `0ce0081` was reviewed and merged in
  `3895c65` after all GitHub checks passed.
- Vercel deployment `dpl_3mzZ82Hjog64wQzWp3CzjazWXbiX` was built from that change,
  accepted on its unpromoted Production-target URL, then promoted unchanged to
  `dreamtrace.vercel.app`.
- The required Runpod endpoint is `flux-1-dev-case-study`. Its worker is built from the
  repository root Dockerfile and starts `handler.py`; no model weights or credentials are
  committed to Git.
- The endpoint remains queue based with one active worker, one-worker maximum, a
  300-second idle timeout, a 600-second execution timeout, and three allowed H100 tiers.

## Release gates

- GitHub CI passed strict Python typecheck, 54 tests, Ruff, web typecheck, 240 tests,
  ESLint, the Next.js Production build, and a clean custom-worker Docker build.
- The post-release acceptance guard passes 54 Python tests and 247 web tests locally,
  including bounded transient GET retries and one-attempt POST, PUT, PATCH, and DELETE.
- Supabase migrations 001 through 037 match the linked project. Remote schema lint has
  no errors.
- The disposable linked-project fixture completed identity lifecycle and branch recovery,
  including terminal audio replay, stale-audio cleanup, cross-user RLS, one-active-branch
  enforcement, and retry after failed branches. It left zero integration jobs.
- Public `/`, `/capture`, and `/journal` routes returned HTTP 200 after promotion. Vercel
  reported the deployment `Ready` and returned no error logs for the acceptance window.
- The production dependency audit reported no known runtime vulnerabilities.

## Final production acceptance

The promoted release completed new three-scene and four-scene stories plus one regenerated
scene.
The runner verified duplicate text submissions did not create duplicate dreams, duplicate
branch submissions did not create duplicate versions, and selecting the branch twice left
the new version selected. Both stories finished `READY` with exactly one selected,
completed image per scene.

One read-only status poll encountered `ECONNRESET`; the durable workflow still completed
`READY` with all three images and Vercel reported no 5xx or error log. The acceptance
runner now retries only allowlisted transient GET failures, at most three total attempts.
Mutating requests are never retried by that transport helper. Two independent fresh-context
reviews challenged the boundary before the corrected run passed.

Immediately afterward, Runpod reported no queued, in-progress, retried, throttled, or
unhealthy work across the used endpoints. The UTC-day admission ledgers were 89/100 story
GPU slots and 1/40 Dream Self uploads; the high story count includes deliberate linked
database quota fixtures that reserve capacity without submitting GPU jobs.

## Adaptive story acceptance

The planner was tested at both boundaries on the exact Vercel artifact later promoted:

| Input shape | Expected | Observed |
| --- | ---: | ---: |
| One continuous setting and action | 1 scene | 1 selected completed scene |
| Six explicit changes of setting/action | 6 scenes | 6 contiguous selected completed scenes |

An earlier single-beat probe produced three repetitive scenes. That failure led to a
calibrated scene-boundary rubric: a new scene now requires a meaningful change in setting,
time, central action, or story beat. The corrected one- and six-scene runs both reached
`READY`.

A separate no-photo acceptance created two ordinary three-scene stories, replayed both
submissions without duplicate dreams, generated a Kontext edit from scene two, replayed
the branch without a duplicate version, selected the edit twice, and verified that the
selection persisted. Scene one used the required custom FLUX.1-dev endpoint; continuation
and edit scenes used Runpod Kontext.

## Dream Self acceptance

A clearly synthetic, fictional portrait completed the private identity flow:

1. signed upload preparation replay returned the same identity;
2. normalization produced a metadata-free private PNG;
3. a watercolor story reached `READY` with three contiguous scenes;
4. every scene used the immutable normalized identity reference with Runpod Kontext;
5. removal returned success after generation;
6. the database tombstone was `DELETED` and inactive, with upload path, storage path,
   dimensions, size, content hash, and retention timestamp cleared.

Measured provider timings for the final identity run were:

| Stage | Queue delay | Execution | Provider cost |
| --- | ---: | ---: | ---: |
| Qwen plan | 146 ms | 1,576 ms | unavailable |
| Kontext identity scene 1 | 3,953 ms | 17,202 ms | $0.025 |
| Kontext identity scene 2 | 17 ms | 13,471 ms | $0.025 |
| Kontext identity scene 3 | 16 ms | 12,134 ms | $0.025 |

Visual inspection found one consistent dreamer in all three illustrations with no
duplicated protagonist. Exact action fidelity remains a model-quality limitation: some
results preserve identity and setting more strongly than the requested pose.

## Required custom endpoint evidence

The custom `handler.py` worker has independently produced valid 512x512 and 1024x1024
RGB PNGs from FLUX.1-dev. The full-quality seed-42 red-panda image reported 10.452 seconds
of inference and 11.624 seconds of Runpod execution. Repeated full-quality requests on
the same warm worker were byte-identical, while the documentation makes no claim of
cross-GPU bit determinism.

The invalid-width request reached Runpod `FAILED` with a sanitized validation error. It
did not return an error object inside a successful job or restart the worker.

## Privacy and failure evidence

- Provider artifacts are downloaded only from approved HTTPS Runpod image hosts. Every
  redirect is revalidated, credentials and non-default ports are rejected, and response
  size plus PNG signature are bounded before private storage.
- If image storage succeeds but the database definitively rejects completion, the exact
  orphan is removed. An ambiguous completion keeps the object so a committed success is
  not corrupted during reconciliation.
- Failed and cancelled scene edits expose a user retry. `SUBMIT_UNKNOWN` is terminal and
  is not polled forever or blindly resubmitted.
- Paid jobs persist endpoint, model, request hash, provider ID, state, timing, and cost
  provenance before their results can become selected story state.

## Honest remaining scope

- Anonymous journals are browser-session bound until account linking is added.
- Dream Self input validation does not yet reject zero-face or multi-face photos; the UI
  requests one clear subject and visual review remains the quality gate.
- Users can remove the Dream Self source, but the take-home does not yet expose deletion
  or configurable retention for completed journal stories.
- The public Kontext endpoint accepts one reference image, so identity stories prioritize
  the face reference while continuity relies on the visual bible. Multi-reference control
  would need a separate model and privacy evaluation.
