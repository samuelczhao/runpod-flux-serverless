# Project Instructions

## Known Pitfalls

- Match the validation scopes in `.github/workflows/ci.yml`. Mypy checks `handler.py`,
  `src`, and `scripts`; pytest and Ruff cover `tests`. Do not expand the mypy scope
  without first resolving third-party stubs and test-only typing patterns.
