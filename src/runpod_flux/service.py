import logging
import time
from collections.abc import Mapping

from runpod_flux.constants import MODEL_ID
from runpod_flux.contracts import EncodedImage, GenerationRequest, ImageGenerator, JsonObject
from runpod_flux.encoding import encode_png
from runpod_flux.errors import InferenceError, InputValidationError
from runpod_flux.logging import log_event, log_exception
from runpod_flux.validation import validate_job


class GenerationService:
    def __init__(self, generator: ImageGenerator) -> None:
        self._generator = generator

    def handle(self, job: Mapping[str, object]) -> JsonObject:
        job_id = _job_id(job)
        try:
            request = validate_job(job)
        except InputValidationError as error:
            log_event(
                "validation_failed",
                level=logging.WARNING,
                job_id=job_id,
                field=error.field,
            )
            raise
        return self._generate(job_id, request)

    def _generate(self, job_id: str, request: GenerationRequest) -> JsonObject:
        started_at = time.perf_counter()
        _log_generation_started(job_id, request)
        try:
            image = self._generator.generate(request)
            encoded = encode_png(image)
        except Exception as error:
            log_exception("generation_failed", job_id=job_id, error_type=type(error).__name__)
            raise InferenceError("Image generation failed") from error
        duration_ms = round((time.perf_counter() - started_at) * 1_000)
        log_event("generation_completed", job_id=job_id, inference_ms=duration_ms)
        return _success_response(request, encoded, self._generator.revision, duration_ms)


def _job_id(job: Mapping[str, object]) -> str:
    value = job.get("id")
    return value if isinstance(value, str) and value else "unknown"


def _log_generation_started(job_id: str, request: GenerationRequest) -> None:
    log_event(
        "generation_started",
        job_id=job_id,
        prompt_characters=len(request.prompt),
        seed=request.seed,
        width=request.width,
        height=request.height,
        num_inference_steps=request.num_inference_steps,
        guidance_scale=request.guidance_scale,
    )


def _success_response(
    request: GenerationRequest,
    encoded: EncodedImage,
    revision: str,
    duration_ms: int,
) -> JsonObject:
    return {
        "image_base64": encoded.data,
        "mime_type": "image/png",
        "seed": request.seed,
        "width": request.width,
        "height": request.height,
        "num_inference_steps": request.num_inference_steps,
        "guidance_scale": request.guidance_scale,
        "model": {"id": MODEL_ID, "revision": revision},
        "metrics": {"inference_ms": duration_ms, "png_bytes": encoded.byte_count},
    }
