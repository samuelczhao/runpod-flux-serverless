import logging
import time
from collections.abc import Mapping

from PIL import Image

from runpod_flux.constants import INFERENCE_ERROR_MESSAGE, MILLISECONDS_PER_SECOND, MODEL_ID
from runpod_flux.contracts import EncodedImage, GenerationRequest, ImageGenerator, JsonObject
from runpod_flux.encoding import encode_png
from runpod_flux.errors import InferenceError, InputValidationError
from runpod_flux.logging import log_event
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
            return _validation_error_response(error)
        return self._generate(job_id, request)

    def _generate(self, job_id: str, request: GenerationRequest) -> JsonObject:
        started_at = time.perf_counter()
        _log_generation_started(job_id, request)
        try:
            image, inference_ms = self._run_inference(request)
            encoded, encoding_ms = _encode_image(image)
        except Exception as error:
            log_event(
                "generation_failed",
                level=logging.ERROR,
                job_id=job_id,
                error_type=type(error).__name__,
            )
            return {"error": INFERENCE_ERROR_MESSAGE}
        total_ms = _elapsed_ms(started_at)
        _log_generation_completed(job_id, inference_ms, encoding_ms, total_ms)
        metrics = _metrics(inference_ms, encoding_ms, total_ms, encoded.byte_count)
        return _success_response(request, encoded, self._generator.revision, metrics)

    def _run_inference(self, request: GenerationRequest) -> tuple[Image.Image, int]:
        started_at = time.perf_counter()
        image = self._generator.generate(request)
        if image.size != (request.width, request.height):
            raise InferenceError("Generated image dimensions do not match the request")
        return image, _elapsed_ms(started_at)


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


def _encode_image(image: Image.Image) -> tuple[EncodedImage, int]:
    started_at = time.perf_counter()
    encoded = encode_png(image)
    return encoded, _elapsed_ms(started_at)


def _elapsed_ms(started_at: float) -> int:
    return round((time.perf_counter() - started_at) * MILLISECONDS_PER_SECOND)


def _log_generation_completed(
    job_id: str,
    inference_ms: int,
    encoding_ms: int,
    total_ms: int,
) -> None:
    log_event(
        "generation_completed",
        job_id=job_id,
        inference_ms=inference_ms,
        encoding_ms=encoding_ms,
        total_ms=total_ms,
    )


def _metrics(
    inference_ms: int,
    encoding_ms: int,
    total_ms: int,
    png_bytes: int,
) -> JsonObject:
    return {
        "inference_ms": inference_ms,
        "encoding_ms": encoding_ms,
        "total_ms": total_ms,
        "png_bytes": png_bytes,
    }


def _validation_error_response(error: InputValidationError) -> JsonObject:
    return {"error": f"invalid_input:{error.field}: {error.message}"}


def _success_response(
    request: GenerationRequest,
    encoded: EncodedImage,
    revision: str,
    metrics: JsonObject,
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
        "metrics": metrics,
    }
