import base64
import logging

import pytest
from PIL import Image

from runpod_flux.contracts import GenerationRequest
from runpod_flux.errors import InferenceError, InputValidationError
from runpod_flux.service import GenerationService

SECRET_MARKER = "do-not-log-this-prompt"


class StubGenerator:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.requests: list[GenerationRequest] = []

    @property
    def revision(self) -> str:
        return "abc123"

    def generate(self, request: GenerationRequest) -> Image.Image:
        self.requests.append(request)
        if self.fail:
            raise RuntimeError("private backend detail")
        return Image.new("RGB", (request.width, request.height), color="blue")


def test_returns_image_and_reproducibility_metadata() -> None:
    generator = StubGenerator()
    result = GenerationService(generator).handle(_job())

    assert base64.b64decode(str(result["image_base64"])).startswith(b"\x89PNG")
    assert result["mime_type"] == "image/png"
    assert result["seed"] == 42
    assert result["model"] == {"id": "black-forest-labs/FLUX.1-dev", "revision": "abc123"}
    assert generator.requests[0].prompt == SECRET_MARKER


def test_invalid_input_raises_for_failed_job_state() -> None:
    with pytest.raises(InputValidationError, match="prompt"):
        GenerationService(StubGenerator()).handle({"id": "job-1", "input": {}})


def test_sanitizes_inference_failure(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.ERROR), pytest.raises(InferenceError) as captured:
        GenerationService(StubGenerator(fail=True)).handle(_job())

    assert str(captured.value) == "Image generation failed"
    assert "private backend detail" not in str(captured.value)


def test_logs_metadata_without_prompt_or_image(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        GenerationService(StubGenerator()).handle(_job())

    assert SECRET_MARKER not in caplog.text
    assert "image_base64" not in caplog.text
    assert "generation_completed" in caplog.text


def _job() -> dict[str, object]:
    return {
        "id": "job-1",
        "input": {
            "prompt": SECRET_MARKER,
            "seed": 42,
            "width": 512,
            "height": 512,
            "num_inference_steps": 1,
            "guidance_scale": 3.5,
        },
    }
