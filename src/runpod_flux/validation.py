import math
import secrets
from collections.abc import Mapping
from typing import cast

from runpod_flux.constants import (
    ALLOWED_INPUT_FIELDS,
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_HEIGHT,
    DEFAULT_STEPS,
    DEFAULT_WIDTH,
    DIMENSION_MULTIPLE,
    MAX_DIMENSION,
    MAX_GUIDANCE_SCALE,
    MAX_PROMPT_LENGTH,
    MAX_SEED,
    MAX_STEPS,
    MIN_DIMENSION,
    MIN_GUIDANCE_SCALE,
    MIN_STEPS,
)
from runpod_flux.contracts import GenerationRequest
from runpod_flux.errors import InputValidationError


def validate_job(job: Mapping[str, object]) -> GenerationRequest:
    job_input = _mapping(job.get("input"), "input")
    _reject_unknown_fields(job_input)
    return GenerationRequest(
        prompt=_prompt(job_input),
        seed=_seed(job_input),
        width=_dimension(job_input, "width", DEFAULT_WIDTH),
        height=_dimension(job_input, "height", DEFAULT_HEIGHT),
        num_inference_steps=_steps(job_input),
        guidance_scale=_guidance_scale(job_input),
    )


def _mapping(value: object, field: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise InputValidationError(field, "must be a JSON object")
    if not all(isinstance(key, str) for key in value):
        raise InputValidationError(field, "must use string keys")
    return cast(Mapping[str, object], value)


def _reject_unknown_fields(job_input: Mapping[str, object]) -> None:
    unknown = sorted(set(job_input) - ALLOWED_INPUT_FIELDS)
    if unknown:
        names = ", ".join(unknown)
        raise InputValidationError("input", f"contains unknown fields: {names}")


def _prompt(job_input: Mapping[str, object]) -> str:
    value = job_input.get("prompt")
    if not isinstance(value, str):
        raise InputValidationError("prompt", "must be a string")
    prompt = value.strip()
    if not prompt:
        raise InputValidationError("prompt", "must not be empty")
    if len(prompt) > MAX_PROMPT_LENGTH:
        raise InputValidationError("prompt", f"must be at most {MAX_PROMPT_LENGTH} characters")
    return prompt


def _integer(value: object, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise InputValidationError(field, "must be an integer")
    if value < minimum or value > maximum:
        raise InputValidationError(field, f"must be between {minimum} and {maximum}")
    return value


def _seed(job_input: Mapping[str, object]) -> int:
    if "seed" not in job_input:
        return secrets.randbelow(MAX_SEED + 1)
    return _integer(job_input["seed"], "seed", 0, MAX_SEED)


def _dimension(job_input: Mapping[str, object], field: str, default: int) -> int:
    value = _integer(job_input.get(field, default), field, MIN_DIMENSION, MAX_DIMENSION)
    if value % DIMENSION_MULTIPLE:
        raise InputValidationError(field, f"must be divisible by {DIMENSION_MULTIPLE}")
    return value


def _steps(job_input: Mapping[str, object]) -> int:
    value = job_input.get("num_inference_steps", DEFAULT_STEPS)
    return _integer(value, "num_inference_steps", MIN_STEPS, MAX_STEPS)


def _guidance_scale(job_input: Mapping[str, object]) -> float:
    value = job_input.get("guidance_scale", DEFAULT_GUIDANCE_SCALE)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputValidationError("guidance_scale", "must be a number")
    scale = float(value)
    if not math.isfinite(scale):
        raise InputValidationError("guidance_scale", "must be finite")
    if scale < MIN_GUIDANCE_SCALE or scale > MAX_GUIDANCE_SCALE:
        message = f"must be between {MIN_GUIDANCE_SCALE} and {MAX_GUIDANCE_SCALE}"
        raise InputValidationError("guidance_scale", message)
    return scale
