# Project Instructions

## Known Pitfalls

- Match the validation scopes in `.github/workflows/ci.yml`. Mypy checks `handler.py`,
  `src`, and `scripts`; pytest and Ruff cover `tests`. Do not expand the mypy scope
  without first resolving third-party stubs and test-only typing patterns.
- Exercise documented CLI entrypoints in a subprocess without relying on `PYTHONPATH`
  or editable-install path injection.
- Keep `src` explicit in pytest's import path for this src-layout project; do not rely
  on platform-specific editable-install behavior.
- `next typegen && tsc --noEmit` creates `web/tsconfig.tsbuildinfo`; keep incremental
  compiler caches ignored and review staged generated files before committing.
- Keep provider-decoding catches narrower than database persistence; a broad catch
  can misclassify a transient database failure as invalid paid-provider output.
- Verify prompt-injection boundaries by parsing the structured envelope; escaped
  text searches do not prove that user data stayed inside a single message field.
- Run remote migration and schema-lint commands separately so each result remains
  attributable if the migration fails or prompts unexpectedly.
- Use the checked demo-seed CLI for multi-step paid workflows; long inline shell
  orchestration is too typo-prone and can lose an anonymous session after creation.
- Check that the Docker CLI is available before local image verification. This Mac
  session may rely on Runpod and GitHub CI builds instead of a local Docker daemon.
- Do not run `next build` or `next typegen` in a checkout serving local workflows.
  They share `.next` and can invalidate the local workflow event store mid-run.
- Bound durable provider polling by event count as well as wall-clock intent. Frequent
  sleeps create replay history, so long cold starts need a backed-off poll schedule.
- Audio smoke tests must confirm the reviewed transcript through
  `/api/dreams/{dreamId}/transcript`; transcription intentionally stops in `PLANNING`
  so a user can correct Whisper output before image-generation spend begins.
