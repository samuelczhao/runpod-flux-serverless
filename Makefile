.PHONY: typecheck test lint check

typecheck:
	uv run mypy handler.py src scripts

test:
	uv run pytest

lint:
	uv run ruff check .

check: typecheck test lint
