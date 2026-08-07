import math

import pytest

from runpod_flux.constants import MAX_PROMPT_LENGTH, MAX_SEED
from runpod_flux.errors import InputValidationError
from runpod_flux.validation import validate_job


def test_prompt_only_uses_documented_defaults() -> None:
    request = validate_job({"input": {"prompt": "  a lighthouse  "}})

    assert request.prompt == "a lighthouse"
    assert (request.width, request.height) == (1024, 1024)
    assert request.num_inference_steps == 50
    assert request.guidance_scale == 3.5
    assert 0 <= request.seed <= MAX_SEED


def test_accepts_boundary_values() -> None:
    request = validate_job(
        {
            "input": {
                "prompt": "x",
                "seed": 0,
                "width": 512,
                "height": 1024,
                "num_inference_steps": 1,
                "guidance_scale": 0,
            }
        }
    )

    assert request.seed == 0
    assert request.guidance_scale == 0.0


@pytest.mark.parametrize(
    ("job", "field"),
    [
        ({}, "input"),
        ({"input": None}, "input"),
        ({"input": {}}, "prompt"),
        ({"input": {"prompt": " "}}, "prompt"),
        ({"input": {"prompt": "x", "seed": True}}, "seed"),
        ({"input": {"prompt": "x", "width": 511}}, "width"),
        ({"input": {"prompt": "x", "width": 520}}, "width"),
        ({"input": {"prompt": "x", "height": 1040}}, "height"),
        ({"input": {"prompt": "x", "num_inference_steps": 0}}, "num_inference_steps"),
        ({"input": {"prompt": "x", "guidance_scale": math.inf}}, "guidance_scale"),
        ({"input": {"prompt": "x", "unexpected": 1}}, "input"),
    ],
)
def test_rejects_invalid_input(job: dict[str, object], field: str) -> None:
    with pytest.raises(InputValidationError) as captured:
        validate_job(job)

    assert captured.value.field == field


def test_rejects_overlong_prompt() -> None:
    with pytest.raises(InputValidationError, match="at most"):
        validate_job({"input": {"prompt": "x" * (MAX_PROMPT_LENGTH + 1)}})
