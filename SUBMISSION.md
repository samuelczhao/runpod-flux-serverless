# Runpod Serverless Endpoint Case Study Submission

Candidate: Samuel Zhao

## Submission links

- Repository: [github.com/samuelczhao/runpod-flux-serverless](https://github.com/samuelczhao/runpod-flux-serverless)
- Live product: [dreamtrace.vercel.app](https://dreamtrace.vercel.app)
- Required endpoint: `flux-1-dev-case-study` (`ehxieutvv2to04`)
- Generated result: [1024x1024 FLUX.1-dev image](artifacts/red-panda-1024.png)
- Measured production evidence: [docs/EVIDENCE.md](docs/EVIDENCE.md)
- Presentation runbook: [docs/PRESENTATION.md](docs/PRESENTATION.md)

The live site is public. Direct Runpod API calls remain authenticated; no API or
Hugging Face token is included in this repository or submission.

## Requirement coverage

| Case-study requirement | Implementation and evidence |
| --- | --- |
| Run a model on Runpod Serverless | Custom queue endpoint running `black-forest-labs/FLUX.1-dev` |
| Write a serverless handler | [`handler.py`](handler.py) starts the Runpod handler after one-time model initialization |
| Build a Docker image | [`Dockerfile`](Dockerfile) provides the locked CUDA/PyTorch runtime and worker code |
| Provision the model | Runpod cached-model mounting supplies the gated weights; the worker resolves and records the exact cached revision without embedding credentials in image layers |
| Accept text and return an image | The documented JSON request returns a validated base64 PNG plus seed, dimensions, revision, and timing metadata |
| Test the endpoint | [`scripts/invoke.py`](scripts/invoke.py), 54 worker tests, live 512x512 and 1024x1024 acceptance, and container CI |
| Demonstrate a generated image | The generated red-panda image is rendered in the README and linked above |
| Share code and configuration | Public repository with deployment, design, testing, security, and rollback documentation |

## Evaluator path

1. Read the [README](README.md) for the product, architecture, request contract, and
   generated endpoint result.
2. Inspect [`handler.py`](handler.py), [`Dockerfile`](Dockerfile), and
   [`src/runpod_flux/`](src/runpod_flux/) for the required custom worker.
3. Open [DreamTrace](https://dreamtrace.vercel.app) to see the endpoint used inside a
   private visual dream journal.
4. Review [production evidence](docs/EVIDENCE.md) for exact release identity, live
   acceptance, privacy behavior, measured jobs, and honest remaining scope.
5. Review [design decisions](docs/DESIGN.md) and [testing](docs/TESTING.md) for model
   caching, GPU choice, queue semantics, retries, idempotency, and cost controls.

Runpod workers scale to zero outside a presentation window. A first request may wait for
worker initialization, but the queued workflow remains durable and must not be submitted
twice. The prepared image and production evidence remain available during a cold start.

## Verification snapshot

- Python: strict typecheck, 54 tests, and Ruff
- Web: strict typecheck, 45 test files with 247 tests, ESLint, and Production build
- Container: GitHub clean-image build and worker test
- Database: migrations 001 through 037 aligned with Production; remote schema lint clean
- Production: `/`, `/capture`, and `/journal` return HTTP 200 with no acceptance-window
  5xx logs

## Suggested submission note

> Hi Hailong,
>
> Here is my Runpod Serverless Endpoint case-study submission:
>
> Repository: https://github.com/samuelczhao/runpod-flux-serverless  
> Live application: https://dreamtrace.vercel.app  
> Runpod endpoint: `flux-1-dev-case-study`
>
> I implemented the required custom FLUX.1-dev serverless worker and then built
> DreamTrace, a private visual dream journal that uses Runpod for story planning,
> transcription, image generation, continuity, and scene editing. The repository
> includes the handler, Docker configuration, request client, generated result,
> deployment instructions, design decisions, tests, and measured production evidence.
>
> I look forward to demonstrating it live.
