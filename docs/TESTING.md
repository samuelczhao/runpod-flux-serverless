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
| pytest | Passed, 53 tests |
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

## Queue check

With Max workers at 1, submit two async jobs back-to-back. Confirm one is processed while
the other remains queued, both eventually complete, and no second worker is launched.
This demonstrates the cost cap and expected concurrency behavior.
