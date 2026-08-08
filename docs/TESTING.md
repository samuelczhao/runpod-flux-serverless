# Testing and acceptance

## Local quality gate

Run each command in order:

```bash
make typecheck
make test
make lint
```

Current local evidence:

| Check | Result |
| --- | --- |
| mypy strict | Passed, 14 source files |
| pytest | Passed, 54 tests |
| Ruff | Passed |

The unit suite covers default and boundary inputs, malformed types, booleans as integers,
unknown fields, NaN/infinity, cache reference resolution, missing and ambiguous cache
snapshots, exact generator arguments, PNG signatures, a full 1024×1024 response envelope,
failed-job semantics through Runpod's SDK, sync-to-async fallback, sanitized inference
errors, and prompt/image log redaction.

These checks validate application behavior without downloading the gated model. The live
evidence below separately validates the deployed CUDA path.

## Live GPU smoke test

The deployed smoke input is versioned as `test_input_smoke.json`:

```json
{
  "input": {
    "prompt": "A small red panda astronaut reading a map on Mars, cinematic lighting",
    "seed": 42,
    "width": 512,
    "height": 512,
    "num_inference_steps": 1,
    "guidance_scale": 3.5
  }
}
```

Observed result:

- Job reached `COMPLETED` and decoded to a valid 512×512 RGB PNG.
- Response reported seed 42, one step, the FLUX.1-dev model ID, and cached revision
  `3de623fc3c33e44ffbe2bad470d0f45bccf2eb21`.
- The first post-deploy request reported 26.637 seconds of queue delay while the worker
  initialized, followed by 0.734 seconds of inference.

## Full-quality acceptance

Load `.env`, then run the default async client against `test_input.json`:

```bash
set -a
source .env
set +a
uv run python scripts/invoke.py --output artifacts/full-quality.png
```

Acceptance criteria:

- Job reaches `COMPLETED` within the 600-second execution timeout.
- The saved image is 1024×1024 PNG and visibly corresponds to the prompt.
- Response parameters equal the request and revision equals the worker startup log.
- `metrics.inference_ms` and Runpod's `executionTime` are captured for the report.

## Failure acceptance

Submit an invalid request such as width 513. The job must reach `FAILED`; it must not
reach `COMPLETED` with an error object. Confirm no worker restart loop follows the input
error.

## Reproducibility check

On the same warm worker, submit the same prompt and seed twice. Compare decoded image
SHA-256 values and record whether they match. Do not claim cross-GPU bit determinism.

## Cold/warm benchmark

With Active workers at 0:

1. Let the endpoint fully scale down.
2. Submit the 512×512 smoke request and record queue delay, worker initialization, and
   inference time.
3. Immediately submit three identical warm requests and record delay/execution time.
4. Report median warm execution time and the observed cold-start total separately.

Measured on August 7, 2026 against the configured H100 80 GB pool:

| Scenario | Queue delay | Inference | Worker total | Runpod execution |
| --- | ---: | ---: | ---: | ---: |
| First post-deploy 512×512, 1 step | 26.637 s | 0.734 s | 0.876 s | 1.377 s |
| Warm 512×512, 1 step median (n=3) | 0.147 s | 0.161 s | 0.257 s | 0.719 s |
| Warm 1024×1024, 50 steps | 0.142 s | 10.452 s | 10.787 s | 11.624 s |
| Repeat 1024×1024, 50 steps | 0.963 s | 10.361 s | 10.689 s | 11.618 s |

Runpod did not expose worker initialization as a separate response field; the first
request's queue delay includes time spent waiting for the initializing worker. All four
seed-42 smoke PNGs were byte-identical with SHA-256
`cdd17876d979b29e57b76aca443e93ffecd65200f51fdd605434ee8a7f6e37b2`.
The two full-quality seed-42 PNGs were also byte-identical with SHA-256
`0647d129cd03a55c7d990049a2b7ff2cba2a803f12612925d3716293cc32c17e`.

The invalid-width job reached `FAILED` with
`invalid_input:width: must be divisible by 16` and no traceback.

## Live DreamTrace acceptance

Acceptance requires a planner-selected count from one through six, contiguous ordinals
starting at one, and exactly one selected completed image per scene. The promoted release
passed both boundaries: a single continuous moment produced one scene, while a six-beat
dream with explicit setting/action transitions produced six scenes. Both reached `READY`.

The first single-beat Production probe exposed an over-segmentation failure: Qwen split
the subject, action, and lighting into three repetitive images. The planner rubric now
requires a meaningful change in setting, time, central action, or story beat before it
adds a scene. The exact corrected artifact passed one- and six-scene acceptance before
promotion.

An ordinary no-photo flow also created two `READY` stories and a selected scene edit.
It replayed text creation, branch creation, and branch selection without duplicates.
The first scene used the required custom FLUX endpoint; later scenes and the edit used
Kontext.

The table below retains an earlier voice run because it provides measured Whisper and
custom-worker timings:

Measured on August 7, 2026 with scale-to-zero endpoints and a synthetic, clearly
labeled 13-second voice fixture:

| Stage | Queue delay | Runpod execution | Result |
| --- | ---: | ---: | --- |
| Whisper transcription | 0.795 s | 2.266 s | Exact transcript, source audio deleted |
| Qwen plan | 0.143 s | 2.575 s | Strict three-scene plan |
| Custom FLUX anchor | 0.952 s | 11.678 s | Valid 1024×1024 PNG |
| Kontext scene 2 | 3.661 s | 13.603 s | Valid 1024×1024 PNG, $0.025 |
| Kontext scene 3 | 0.150 s | 16.703 s | Valid 1024×1024 PNG, $0.025 |

The workflow paused after transcription for explicit user confirmation, reached
`READY` after confirmation, retained exactly one selected image per scene, and preserved
the glass whale, compass, violet desert, and cloud staircase across all three images.
Two separate text dreams also reached `READY`; a replayed branch request reused one
version, and the selected red-fox edit persisted without regenerating the other scenes.

After the planner mood contract was tightened, a planner-only scale-from-zero check once
remained in worker initialization for ten minutes and was cancelled without inference.
Keeping one right-sized planner worker active during acceptance removed that capacity
bottleneck; current adaptive runs complete normally.

## Dream Self acceptance

The GPU-free web suite covers normalization limits and metadata removal, versioned
consent, signed-upload response projection, stored/ready replay, source cleanup replay,
ambiguous database completion, deterministic tombstone cleanup, provider-URL signing
before job claim, stable request hashing, style/identity audio retry behavior, and prompt
budget preservation. Current local result: 44 files and 237 tests passed, followed by
zero-warning ESLint and a successful Next.js Production build.

Together, the GPU-free suite, linked-project fixture, and live synthetic-portrait run
verified:

1. replacement does not remove the current photo before the new one is ready;
2. the original upload disappears while the normalized object remains private;
3. short, medium, and six-beat dreams create the planner-selected scene count;
4. every identity-aware scene depicts the same recognizable person in the selected style;
5. a no-photo story still uses the repository's custom FLUX endpoint for scene one;
6. manual removal blocks during active generation and succeeds afterward;
7. no signed identity URL, token, user ID, or prompt appears in captured logs.

The reference was deleted after generation. Its database tombstone was inactive and all
paths, dimensions, size, content hash, and retention timestamp were cleared. Visual
inspection found one consistent dreamer without duplicates across all three scenes;
pose-level action fidelity remains a known model-quality limitation.

Identity quality is a visual acceptance criterion, not a unit-test claim. Keep recording
fixture provenance, prompt, style, selected images, Runpod timings, and exact release
commit without committing the face image or signed URLs.

## Public-demo admission controls

The database is the authoritative GPU-allocation boundary. It allows at most two active
or freshly prepared dreams per journal, six new dreams per journal per UTC hour, and 12
scene edits per journal per UTC hour. Each story conservatively reserves eight Runpod job
slots and each edit reserves one from 100 slots across the demo per UTC day. This covers
the worst-case audio story: transcription, planning, and six images. Dream Self separately
allows six photo preparations per journal per UTC hour and 40 across the demo per UTC day,
with at most two pending at once. Exact operation replays return the original record
without consuming another slot. Global counters remain durable when an anonymous user is
deleted, so a new browser session cannot bypass either daily ceiling.

After applying migrations, run the opt-in linked verifier with a service credential:

```bash
pnpm --dir web test:db:quotas:linked
```

It exercises concurrent text/audio admission, scene-edit and photo ceilings, replay and
conflict precedence, stale workflow claims, denial codes, durable counters, and fixture
cleanup. It consumes 60 Runpod job slots and six photo-preparation slots from
the current UTC day, but it does not call a GPU.

## Queue check

With Max workers at 1, submit two async jobs back-to-back. Confirm one is processed while
the other remains queued, both eventually complete, and no second worker is launched.
This demonstrates the concurrency ceiling and expected queue behavior. It does not cap
cumulative spend; active-worker settings and account budgets must be managed separately.
