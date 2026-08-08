# Production acceptance evidence

Validated on August 8, 2026 UTC (August 7 PT) against
[dreamtrace.vercel.app](https://dreamtrace.vercel.app). Operational identifiers, signed
URLs, anonymous user IDs, and credentials are intentionally omitted.

## Release gates

- GitHub CI passed Python typecheck, 53 tests, Ruff, web typecheck, 152 tests, ESLint,
  Next.js Production build, and a clean Docker build of the custom Runpod worker.
- Supabase migrations 001 through 023 match the linked project; remote schema lint has
  no errors, and the disposable database recovery fixture passed.
- Public `/`, `/capture`, and `/journal` routes returned HTTP 200 without Vercel SSO.
- Vercel registered `/api/internal/audio-cleanup` at `17 4 * * *`; a manual authenticated
  invocation returned HTTP 200.

## Text and branch flow

The Production smoke client created two private dreams under one anonymous session. Each
reached `READY` with exactly three selected completed images. It then generated a scene-two
Kontext branch, replayed branch creation without a duplicate version, selected the new
version, replayed selection, and verified the choice persisted.

This flow exercised two Qwen plans and seven image jobs: two custom FLUX.1-dev anchors,
four Kontext continuation scenes, and one Kontext edit.

## Voice flow

A 91 KB OGG recording completed this sequence:

1. private signed upload;
2. replayed upload completion without a second transcription workflow;
3. Runpod Whisper transcription and transcript review;
4. replayed transcript confirmation with the same workflow run;
5. Qwen plan, custom FLUX anchor, two Kontext scenes;
6. `READY` with exactly three private selected images;
7. durable source-audio cleanup scheduled for the signed-upload expiry.

Measured provider timings were:

| Stage | Queue delay | Execution |
| --- | ---: | ---: |
| Whisper transcription | 146 ms | 6,421 ms |
| Qwen plan | 140 ms | 1,814 ms |
| Custom FLUX anchor | 14 ms | 11,047 ms |
| Kontext scene two | 4,437 ms | 15,259 ms |
| Kontext scene three | 148 ms | 14,577 ms |

Runpod reported $0.025 for each managed Kontext scene. The custom endpoints did not
return provider cost metadata, so the database records their cost source as unavailable
instead of inventing an estimate.

## Failure evidence that improved the release

- The original Vercel admin credential was invalid; a direct Supabase REST probe selected
  the verified service-role credential before GPU work resumed.
- A scale-to-zero planner allocation on a 4090 was throttled long enough to reach the
  bounded local cancellation deadline. Prioritizing one active A4000 worker eliminated
  the measured capacity bottleneck for the 4B AWQ model.
- Production voice testing found and fixed two boundary bugs: provider-only `signedUrl`
  leakage into a strict browser response and PostgreSQL `+00:00` timestamp parsing.
  Both fixes have regression tests.

These failures are retained as evidence of bounded cancellation, idempotent recovery,
and production-oriented debugging rather than hidden from the presentation.
