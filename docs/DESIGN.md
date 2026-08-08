# Design decisions and tradeoffs

## Goals

The required endpoint must turn a text prompt into a FLUX.1-dev image, behave
predictably under invalid input, fit Runpod's serverless execution model, and remain
easy to demonstrate. DreamTrace is a deliberate product extension around that worker;
it adds a web UI, private object storage, a relational journal, and durable multi-model
orchestration without changing the required endpoint contract.

## Decisions

### Product extension without hiding the case study

DreamTrace uses the custom worker for its anchor scene, then adds a dedicated Qwen
planner and Kontext continuity/edit stages. This keeps the evaluator's requested
handler, image, endpoint, and direct request test independently reviewable while showing
how the endpoint participates in a coherent application.

Tradeoff: the application has more infrastructure than the minimum submission. The
worker remains runnable and documented on its own, and each added provider boundary has
strict validation, persisted identity, and an explicit one-worker concurrency ceiling.

### Adaptive scene count with one visual anchor

The planner chooses one to six scenes and is instructed to use the fewest scenes that
cover every important visual beat. The plan transaction creates contiguous ordinals,
and the durable workflow validates and records that ordered list before iterating. Scene one
always uses the required custom FLUX worker; later scenes use the selected scene-one
image as the stable Kontext reference.

Tradeoff: longer dreams can submit up to six sequential image jobs, increasing latency
and spend. The hard upper bound, sequential execution, persisted operation keys, and
dynamic finalization keep that work predictable and replay-safe, while short memories
avoid padded or repetitive images.

### Durable paid-work accounting

The application claims a generation operation in Postgres before calling Runpod. The
claim records the exact endpoint, model, stable request hash, and operation key. The
external job ID is recorded before polling, and database functions enforce legal state
transitions and idempotent completion.

Text capture also carries a browser-stable operation UUID. The database atomically
returns the same dream for a replay, so a lost HTTP response cannot allocate a second
story. Durable workflow claims keep provisional tokens separate from recorded run IDs;
missing, failed, and cancelled runs can be reclaimed without disturbing a live run.

Tradeoff: an uncertain submission or cancellation cannot be automatically retried. It
is surfaced for reconciliation because duplicate GPU work is more expensive and less
recoverable than a visible incomplete dream.

### Anonymous private journals

Supabase anonymous auth provides a low-friction browser journal while RLS isolates every
row and private object. Service-role access is limited to server workflows; user-facing
reads use the session client so foreign IDs are indistinguishable from missing IDs.

Tradeoff: clearing browser identity can make an anonymous journal inaccessible. Account
linking is the production path for durable cross-device ownership, but is not necessary
to demonstrate the serverless GPU workflow.

### Exact motifs, deterministic layout

Recurring motifs use canonical per-user slugs created from the planner's bounded output.
The journal constellation connects adjacent chronological occurrences and collapses
multiple shared motifs into weighted edges. Golden-angle positions do not move when a
newer dream is appended.

Tradeoff: exact matching is explainable and deterministic but does not merge semantic
synonyms. Embedding-based clustering is deferred until it can be evaluated for false
connections.

### Queue endpoint

FLUX generation and model initialization are long-running GPU work. A queue endpoint
provides job state and async polling, while `/runsync` remains available for the live
demo. The client defaults to `/run` so a cold start does not depend on one HTTP
connection staying open.

### Cached weights, not baked weights

The Docker image owns code and runtime reproducibility. Runpod's Model setting owns
weight delivery. The worker resolves the mounted Hugging Face `refs/main`, records the
resolved commit in each response, and sets Hugging Face, Transformers, and Diffusers to
offline mode before loading.

Tradeoff: the container alone cannot start without Runpod's cached-model mount. In
return, builds remain far below the 80 GB image limit, gated credentials never enter an
image layer, and model downloads happen outside billed worker startup.

### Unquantized BF16 on one 80 GB GPU

This uses the evaluator's model as published, without introducing quantization quality
changes or CPU offload latency. The deployed endpoint enables Runpod's H100 SXM, H100
NVL, and H100 PCIe variants for availability. GPU concurrency is one request per worker,
and the endpoint is capped at one worker for this case study.

Tradeoff: this is more expensive per second than a quantized or offloaded deployment.
Those options would require separate quality and latency evaluation, which is outside
the prompt.

### Load once per worker

`handler.py` creates the service before calling `runpod.serverless.start`. The pipeline
therefore loads once and is reused across jobs. Loading inside the handler would add the
largest possible cost to every request.

### Bounded explicit contract

The worker rejects unknown keys, booleans masquerading as integers, non-finite guidance,
unsupported dimensions, excessive steps, and empty/oversized prompts. Dimensions are
512–1024 and divisible by 16, matching the pipeline's VAE divisibility check while
bounding memory and response size.

Validation failures return Runpod's reserved `error` field so the SDK records `FAILED`
without constructing its traceback-bearing exception response. Inference failures use
the same boundary: log only the error type and return a stable public message. Backend
paths and details are not exposed to callers or application logs.

### Base64 PNG response

A single PNG directly satisfies the exercise without introducing an external object
store. The encoded output is capped at 8,000,000 characters, safely below Runpod's
documented request limits for the chosen dimensions in expected use.

Tradeoff: base64 adds about 33% overhead and is not ideal for a high-volume production
API. A production extension would upload the image to short-lived object storage and
return a signed URL, after measuring actual payload distribution.

### Reproducibility metadata

Every success returns the effective seed, dimensions, steps, guidance, model ID, cached
revision, inference time, and PNG byte count. A missing seed is generated securely and
returned. The Diffusers generator is CPU-seeded, matching the model-card example and
making seed handling independent of CUDA generator placement.

Exact pixels can still vary across GPU architecture, library, or kernel changes. The
immutable base digest, lockfile, model revision, and response metadata make those inputs
visible rather than promising false cross-platform bit identity.

### Structured privacy-conscious logs

Logs contain job ID, prompt character count, generation parameters, model/GPU metadata,
and timing. They omit prompt text, base64 image data, and credentials. This preserves
operational value without unnecessarily retaining user content.

## Rejected alternatives

| Alternative | Reason rejected |
| --- | --- |
| Download model in each worker startup | Slow, billed, dependent on external availability |
| Bake gated weights into Docker | Credential/layer risk and poor fit for build limits |
| 48 GB GPU with CPU offload | Adds latency and complexity not required by the prompt |
| Quantization | Changes model behavior and needs a quality study |
| Return a filesystem path | Worker storage is not a client-visible response |
| Add S3/object storage now | Extra credentials and infrastructure for one image |
| Load-balancing endpoint | Queue semantics better fit long inference and demonstration |

## Sources

- [Runpod handler functions](https://docs.runpod.io/serverless/workers/handler-functions)
- [Runpod cached models](https://docs.runpod.io/serverless/endpoints/model-caching)
- [Runpod operation reference](https://docs.runpod.io/serverless/endpoints/operation-reference)
- [FLUX.1-dev model card](https://huggingface.co/black-forest-labs/FLUX.1-dev)
- [Diffusers FLUX pipeline](https://huggingface.co/docs/diffusers/api/pipelines/flux)
