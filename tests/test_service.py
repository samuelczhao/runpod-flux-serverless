import asyncio
import base64
import logging

import pytest
from PIL import Image
from runpod.serverless.modules import rp_job

from runpod_flux.contracts import GenerationRequest
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


class WrongSizeGenerator(StubGenerator):
    def generate(self, request: GenerationRequest) -> Image.Image:
        return Image.new("RGB", (1, 1))


def test_returns_image_and_reproducibility_metadata() -> None:
    generator = StubGenerator()
    result = GenerationService(generator).handle(_job())

    assert base64.b64decode(str(result["image_base64"])).startswith(b"\x89PNG")
    assert result["mime_type"] == "image/png"
    assert result["seed"] == 42
    assert result["model"] == {"id": "black-forest-labs/FLUX.1-dev", "revision": "abc123"}
    assert generator.requests[0].prompt == SECRET_MARKER


def test_invalid_input_uses_reserved_error_contract() -> None:
    result = GenerationService(StubGenerator()).handle({"id": "job-1", "input": {}})

    assert result == {"error": "invalid_input:prompt: must be a string"}


def test_sanitizes_inference_failure(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.ERROR):
        result = GenerationService(StubGenerator(fail=True)).handle(_job())

    assert result == {"error": "inference_failed: Image generation failed"}
    assert "private backend detail" not in caplog.text


def test_rejects_generated_image_with_wrong_dimensions() -> None:
    result = GenerationService(WrongSizeGenerator()).handle(_job())

    assert result == {"error": "inference_failed: Image generation failed"}


def test_runpod_sdk_returns_sanitized_validation_failure() -> None:
    service = GenerationService(StubGenerator())

    result = asyncio.run(rp_job.run_job(service.handle, {"id": "job-1", "input": {}}))

    assert result == {"error": "invalid_input:prompt: must be a string"}


def test_runpod_sdk_does_not_serialize_private_exception() -> None:
    service = GenerationService(StubGenerator(fail=True))

    result = asyncio.run(rp_job.run_job(service.handle, _job()))

    assert result == {"error": "inference_failed: Image generation failed"}
    assert "private backend detail" not in str(result)


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
