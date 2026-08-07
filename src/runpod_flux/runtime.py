import os
from pathlib import Path

from runpod_flux.constants import DEFAULT_CACHE_ROOT, MODEL_ID
from runpod_flux.generator import FluxImageGenerator, cuda_metadata
from runpod_flux.logging import configure_logging, log_event
from runpod_flux.model_cache import resolve_cached_snapshot
from runpod_flux.service import GenerationService


def create_service() -> GenerationService:
    configure_logging()
    _configure_hugging_face()
    cache_root = Path(os.environ.get("HF_HUB_CACHE", str(DEFAULT_CACHE_ROOT)))
    snapshot = resolve_cached_snapshot(cache_root, MODEL_ID)
    log_event("model_loading", model=MODEL_ID, revision=snapshot.revision)
    generator = FluxImageGenerator.load(snapshot)
    log_event("worker_ready", model=MODEL_ID, revision=snapshot.revision, cuda=cuda_metadata())
    return GenerationService(generator)


def _configure_hugging_face() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["DIFFUSERS_OFFLINE"] = "1"
    os.environ["HF_ENABLE_PARALLEL_LOADING"] = "YES"
