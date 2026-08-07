# Project Instructions

## Known Pitfalls

- Match the validation scopes in `.github/workflows/ci.yml`. Mypy checks `handler.py`,
  `src`, and `scripts`; pytest and Ruff cover `tests`. Do not expand the mypy scope
  without first resolving third-party stubs and test-only typing patterns.
- Exercise documented CLI entrypoints in a subprocess without relying on `PYTHONPATH`
  or editable-install path injection.
- Keep `src` explicit in pytest's import path for this src-layout project; do not rely
  on platform-specific editable-install behavior.
