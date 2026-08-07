from collections.abc import Mapping

import runpod  # type: ignore[import-untyped]

from runpod_flux.contracts import JsonObject
from runpod_flux.runtime import create_service
from runpod_flux.service import GenerationService

_SERVICE: GenerationService | None = None


def handler(job: Mapping[str, object]) -> JsonObject:
    if _SERVICE is None:
        raise RuntimeError("Worker service is not initialized")
    return _SERVICE.handle(job)


def _initialize() -> None:
    global _SERVICE
    _SERVICE = create_service()


def _main() -> None:
    _initialize()
    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    _main()
