# Live presentation runbook

## Before the call

- Confirm credits and endpoint health.
- Set Active workers to 1 at least 15 minutes before the presentation.
- Run one 512×512 smoke generation and one full-quality generation.
- Keep `test_input.json`, a terminal, Runpod's endpoint page, worker logs, and a PNG
  viewer open.
- Keep the last successful image and redacted response available as fallback artifacts.
- Verify no terminal or browser view exposes API or Hugging Face tokens.

## Seven-minute flow

1. **Outcome — 30 seconds.** Show a generated image and its prompt. State that this is a
   custom queue-based FLUX.1-dev worker on Runpod Serverless.
2. **Architecture — 60 seconds.** Use the README diagram: queue, validation, warm model,
   cached snapshot, PNG response.
3. **Code — 90 seconds.** Show `handler.py`, model initialization, input validation, and
   the deterministic response metadata.
4. **Deployment — 60 seconds.** Show the completed GitHub build and endpoint settings.
   Explain A100/H100 80 GB, cached gated weights, Max workers 1, and FlashBoot.
5. **Live request — 90 seconds.** Run the client, show job ID/status, open the saved PNG,
   and point out the returned seed and model revision.
6. **Engineering judgment — 60 seconds.** Explain cached weights versus baking 58 GB,
   base64 versus object storage, and unquantized BF16 versus quantization/offload.
7. **Evidence — 30 seconds.** Show CI, 52 unit tests, and measured cold/warm results.

## Live command

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
- **GPU unavailable:** show the queued state and the A100/H100 priority configuration.
- **Build regression:** roll back from Runpod's Builds tab and explain the release gate.
- **Live API issue:** show the last successful Runpod job, redacted JSON, image, and exact
  commit/release used. Never substitute an unverified claim.

## Likely questions

**Why not put the model in the image?** Runpod explicitly provides gated model caching;
it avoids credentials in image layers, a roughly 58 GB weight transfer, the 30-minute
build limit, and billed download time while preserving the exact revision in responses.

**Why an 80 GB GPU?** The model card reports about 50 GB to load all components. This
keeps the reference BF16 pipeline on one GPU without offload or quantization tradeoffs.

**Why base64?** It is the smallest complete solution for a single bounded image. At
production volume, measure payloads and return an expiring object-store URL.

**How does it scale?** Runpod queues jobs and can add workers. This evaluation caps Max
workers at 1 for predictable spend; increasing it is an endpoint setting, but requires a
load and cost test first.

**What would you improve next?** Measure cold/warm latency, then decide between a warm
worker, quantization, or compile strategies. Add object storage only if response size or
retention becomes an actual constraint.
