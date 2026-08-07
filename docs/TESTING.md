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
| pytest | Passed, 52 tests |
| Ruff | Passed |

The unit suite covers default and boundary inputs, malformed types, booleans as integers,
unknown fields, NaN/infinity, cache reference resolution, missing and ambiguous cache
snapshots, exact generator arguments, PNG signatures, a full 1024×1024 response envelope,
failed-job semantics through Runpod's SDK, sync-to-async fallback, sanitized inference
errors, and prompt/image log redaction.

These results validate application behavior only. They are not evidence of successful
CUDA inference or a deployed endpoint.

## Live GPU smoke test

Start with the cheapest valid request:

```json
{
  "input": {
    "prompt": "A simple blue ceramic cup on a white table",
    "seed": 7,
    "width": 512,
    "height": 512,
    "num_inference_steps": 1,
    "guidance_scale": 3.5
  }
}
```

Acceptance criteria:

- Job reaches `COMPLETED`.
- Decoded output starts with the PNG signature and opens successfully.
- Response reports seed 7, 512×512, one step, model ID, and a non-empty revision.
- Worker logs show `model_loading`, `worker_ready`, `generation_started`, and
  `generation_completed` without prompt text or base64.

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

Do not publish projected numbers. Fill this table only with measured Runpod results:

| Scenario | GPU | Queue delay | Initialization | Inference | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| Cold 512×512, 1 step | pending | pending | pending | pending | pending |
| Warm 512×512, 1 step median | pending | n/a | n/a | pending | pending |
| Warm 1024×1024, 50 steps | pending | n/a | n/a | pending | pending |

## Queue check

With Max workers at 1, submit two async jobs back-to-back. Confirm one is processed while
the other remains queued, both eventually complete, and no second worker is launched.
This demonstrates the cost cap and expected concurrency behavior.
