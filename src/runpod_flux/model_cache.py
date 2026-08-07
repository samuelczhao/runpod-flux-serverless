from pathlib import Path

from runpod_flux.contracts import ModelSnapshot
from runpod_flux.errors import ModelCacheError


def resolve_cached_snapshot(cache_root: Path, model_id: str) -> ModelSnapshot:
    model_root = cache_root / _model_directory(model_id)
    revision = _referenced_revision(model_root)
    if revision is None:
        return _single_snapshot(model_root)
    snapshot = model_root / "snapshots" / revision
    if not snapshot.is_dir():
        raise ModelCacheError(f"Cached model snapshot is missing: {snapshot}")
    return ModelSnapshot(path=snapshot, revision=revision)


def _model_directory(model_id: str) -> str:
    parts = model_id.split("/")
    if len(parts) != 2 or any(not part or part in {".", ".."} for part in parts):
        raise ModelCacheError(f"Invalid Hugging Face model ID: {model_id}")
    return f"models--{parts[0]}--{parts[1]}"


def _referenced_revision(model_root: Path) -> str | None:
    reference = model_root / "refs" / "main"
    if not reference.is_file():
        return None
    revision = reference.read_text(encoding="utf-8").strip()
    if not revision or not revision.isalnum():
        raise ModelCacheError(f"Invalid cached model revision in {reference}")
    return revision


def _single_snapshot(model_root: Path) -> ModelSnapshot:
    snapshots_root = model_root / "snapshots"
    snapshots = sorted(path for path in snapshots_root.glob("*") if path.is_dir())
    if len(snapshots) != 1:
        raise ModelCacheError(f"Expected one cached snapshot under {snapshots_root}")
    snapshot = snapshots[0]
    return ModelSnapshot(path=snapshot, revision=snapshot.name)

