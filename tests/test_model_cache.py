from pathlib import Path

import pytest

from runpod_flux.errors import ModelCacheError
from runpod_flux.model_cache import resolve_cached_snapshot

MODEL_ID = "black-forest-labs/FLUX.1-dev"
MODEL_DIRECTORY = "models--black-forest-labs--FLUX.1-dev"


def _model_root(cache_root: Path) -> Path:
    return cache_root / MODEL_DIRECTORY


def test_resolves_snapshot_from_main_reference(tmp_path: Path) -> None:
    model_root = _model_root(tmp_path)
    snapshot = model_root / "snapshots" / "abc123"
    snapshot.mkdir(parents=True)
    reference = model_root / "refs" / "main"
    reference.parent.mkdir()
    reference.write_text("abc123\n", encoding="utf-8")

    resolved = resolve_cached_snapshot(tmp_path, MODEL_ID)

    assert resolved.path == snapshot
    assert resolved.revision == "abc123"


def test_falls_back_to_only_snapshot(tmp_path: Path) -> None:
    snapshot = _model_root(tmp_path) / "snapshots" / "revision-one"
    snapshot.mkdir(parents=True)

    resolved = resolve_cached_snapshot(tmp_path, MODEL_ID)

    assert resolved == type(resolved)(path=snapshot, revision="revision-one")


def test_rejects_ambiguous_snapshots(tmp_path: Path) -> None:
    snapshots = _model_root(tmp_path) / "snapshots"
    (snapshots / "one").mkdir(parents=True)
    (snapshots / "two").mkdir()

    with pytest.raises(ModelCacheError, match="Expected one"):
        resolve_cached_snapshot(tmp_path, MODEL_ID)


def test_rejects_missing_referenced_snapshot(tmp_path: Path) -> None:
    reference = _model_root(tmp_path) / "refs" / "main"
    reference.parent.mkdir(parents=True)
    reference.write_text("missing", encoding="utf-8")

    with pytest.raises(ModelCacheError, match="snapshot is missing"):
        resolve_cached_snapshot(tmp_path, MODEL_ID)


@pytest.mark.parametrize("model_id", ["owner", "../model", "owner/../model"])
def test_rejects_invalid_model_id(tmp_path: Path, model_id: str) -> None:
    with pytest.raises(ModelCacheError, match="Invalid Hugging Face model ID"):
        resolve_cached_snapshot(tmp_path, model_id)
