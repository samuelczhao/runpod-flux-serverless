# Project Instructions

## Known Pitfalls

- The Vercel CLI is not installed in the shell path. Invoke it with `npx vercel` from
  the repository root; the linked project already sets `web` as its Root Directory.
  Passing `--cwd web` would target `web/web`.

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
- Planner cold starts can exceed the ten-minute client poll window even with FlashBoot.
  Keep one active A4000-class worker during a live demo and never retry while an existing
  worker is initializing. A primary 4090 allocation was throttled by host capacity.
- Supabase signed-upload responses contain provider-only fields such as `signedUrl`.
  Return an explicit public shape; passthrough schemas can break strict browser clients.
- PostgreSQL `timestamptz` values use offsets such as `+00:00`. Use
  `z.iso.datetime({ offset: true })` at database boundaries instead of assuming `Z`.
- Runpod endpoint responses can embed worker environment secrets when
  `includeWorkers=true`. Project only an explicit safe-field allowlist with `jq`; never
  print the complete worker object or its `env` field.
- macOS sync can create untracked Finder-style copies such as `file 2.ts` during a
  branch update. Before migrations or deployment, inspect `git status`, compare every
  copy byte-for-byte, and quarantine exact duplicates outside the repository.
- macOS ships Bash 3.2 without `mapfile`. Keep deployment and verification snippets
  portable; capture a small number of values into separately quoted variables instead.
- Shell cleanup can mask a failed verification command by becoming the script's final
  successful command. Enable fail-fast behavior or preserve and return the check's exit
  status before unsetting temporary credentials.
- Linked-database fixtures must satisfy invariants added by later migrations. In
  particular, every fixture inserted directly as `READY` needs one to three allowed
  mood labels.
- GitHub app grants are provider-specific. A repository authorized for Runpod is not
  automatically visible to Vercel; `vercel git connect` requires a separate Vercel
  GitHub app installation with access to the repository.
- Workflow-level runtime failures and cancellations can bypass application `catch`
  blocks. Persist the run ID, reconcile terminal status outside the workflow, and clear
  only exact matching database ownership before starting a replacement.
- When moving a contiguous function block between TypeScript modules, inspect both cut
  boundaries immediately; a partial declaration or omitted dependency can survive a
  broad patch even when the destination file is correct.
- When adding a React callback prop, update the destructured parameter and its type in
  the same patch; adding only the type and call site leaves an undefined callback.
- After restructuring async error handling, inspect the final control flow immediately;
  temporary unconditional branches must not survive into the working tree.
- Before replacing a database constraint, check existing lifecycle shapes. Deleted audio
  intentionally retains `audio_uploaded_at` as provenance after path, MIME, and size clear.
