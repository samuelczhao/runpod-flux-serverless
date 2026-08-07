# Deployment runbook

This project uses Runpod's native GitHub integration. Runpod pulls the repository and
root Dockerfile, builds and stores the image, tests the worker, and deploys it to the
endpoint. GitHub Actions is a separate pre-merge quality gate.

## Prerequisites

- Runpod account with credits
- Hugging Face access to the gated FLUX.1-dev repository
- Read-scoped Hugging Face token
- This GitHub repository merged to `main`
- Local `RUNPOD_API_KEY` and blank `RUNPOD_ENDPOINT_ID` in the ignored `.env`

Never add either token to GitHub, the Dockerfile, endpoint environment variables, job
inputs, or logs. The Hugging Face token belongs only in Runpod's Model configuration.

## First deployment

1. In Runpod, open **Settings → Connections → GitHub → Connect**.
2. Authorize only `samuelczhao/runpod-flux-serverless`.
3. Open **Serverless → New Endpoint → Import Git Repository**.
4. Select the repository, branch `main`, and Dockerfile path `Dockerfile`.
5. Select endpoint type **Queue**.
6. Apply the settings below.
7. Click **Deploy Endpoint** and watch the endpoint's **Builds** tab through Pending,
   Building, Uploading, Testing, and Completed.
8. Copy the endpoint ID into `RUNPOD_ENDPOINT_ID` in the local `.env`.

## Endpoint settings

| Setting | Submission/default | Live presentation | Rationale |
| --- | --- | --- | --- |
| Endpoint name | `flux-1-dev-case-study` | same | Recognizable |
| GPU priority 1 | A100 80 GB | same | Fits unquantized BF16 model |
| GPU priority 2 | H100 80 GB | same | Availability fallback |
| GPUs per worker | 1 | 1 | Pipeline is single-GPU |
| Active workers | 0 | 1 | Cost control; remove demo cold start |
| Max workers | 1 | 1 | Hard cost and concurrency bound |
| Idle timeout | 300 seconds | 300 seconds | Avoid reloads during evaluation |
| Execution timeout | 600 seconds | 600 seconds | Bound runaway jobs |
| FlashBoot | enabled | enabled | Faster worker revival |
| Data centers | all | all | Largest eligible GPU pool |
| CUDA versions | 12.6 and newer | same | Matches the CUDA 12.6 image |
| Network volume | none | none | Cached model supplies the weights |

Set **Model** to `black-forest-labs/FLUX.1-dev` and enter the Hugging Face read token in
the adjacent access-token field. Runpod mounts the snapshot under
`/runpod-volume/huggingface-cache/hub/`; the worker resolves `refs/main` to the exact
snapshot and then loads with offline mode enabled.

The model card states that FLUX.1-dev needs about 50 GB of RAM/VRAM to load all
components. A 48 GB GPU therefore is not an honest no-offload target. A100/H100 80 GB
keeps the implementation simple and its performance explanation defensible.

## Build design

The Docker image contains the handler, integration code, CUDA/PyTorch runtime, and a
locked Python dependency graph. It deliberately does not contain the roughly 58 GB of
gated weights.

This is a direct use of Runpod's cached-model feature, which is documented to reduce
cold-start cost and image size. It also avoids GitHub builder limits: a 30-minute Docker
build and an 80 GB final image. The model remains an explicit part of the endpoint
deployment even though the weight bytes are provisioned separately from the container.

## Releases and rollback

The first endpoint deployment builds immediately. Later commits do not automatically
replace workers. After CI passes and code is merged:

1. Create a GitHub Release from the desired `main` commit.
2. Monitor the new build in Runpod's **Builds** tab.
3. Run the smoke and acceptance tests before considering the release healthy.

To roll back, select a previously completed build in the endpoint's **Builds** tab and
choose **Rollback**. Runpod switches to that stored image without rebuilding it.

## Post-deployment checks

Run the tests in [TESTING.md](TESTING.md). Confirm that logs contain model revision, GPU
metadata, seed, dimensions, step count, and timing—but no prompt, image data, or token.

After the presentation, set Active workers back to 0. Delete the endpoint only after the
submission review no longer needs it; deletion also removes endpoint configuration and
job history.

## Official references

- [Deploy workers from GitHub](https://docs.runpod.io/serverless/workers/github-integration)
- [Cached models](https://docs.runpod.io/serverless/endpoints/model-caching)
- [Use Hugging Face models](https://docs.runpod.io/serverless/development/huggingface-models)
- [Endpoint settings](https://docs.runpod.io/serverless/endpoints/endpoint-configurations)
