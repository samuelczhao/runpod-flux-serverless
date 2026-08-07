import base64
import json
import random
from io import BytesIO

import pytest
from PIL import Image

from runpod_flux import encoding
from runpod_flux.contracts import GenerationRequest
from runpod_flux.errors import OutputEncodingError
from runpod_flux.service import GenerationService

ASYNC_PAYLOAD_LIMIT_BYTES = 10_000_000
IMAGE_CHANNELS = 3


class RandomImageGenerator:
    @property
    def revision(self) -> str:
        return "abc123"

    def generate(self, request: GenerationRequest) -> Image.Image:
        byte_count = request.width * request.height * IMAGE_CHANNELS
        pixels = random.Random(0).randbytes(byte_count)
        return Image.frombytes("RGB", (request.width, request.height), pixels)


def test_encodes_png() -> None:
    encoded = encoding.encode_png(Image.new("RGB", (4, 4), color="red"))
    payload = base64.b64decode(encoded.data)

    assert payload.startswith(b"\x89PNG\r\n\x1a\n")
    assert encoded.byte_count == len(payload)
    with Image.open(BytesIO(payload)) as decoded:
        assert decoded.size == (4, 4)


def test_rejects_response_over_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(encoding, "MAX_BASE64_CHARACTERS", 1)

    with pytest.raises(OutputEncodingError, match="response size limit"):
        encoding.encode_png(Image.new("RGB", (1, 1)))


def test_full_1024_response_fits_async_payload_limit() -> None:
    job = {"id": "job-1", "input": {"prompt": "x", "seed": 42}}

    output = GenerationService(RandomImageGenerator()).handle(job)
    envelope = {"id": "job-1", "status": "COMPLETED", "output": output}
    serialized = json.dumps(envelope, separators=(",", ":")).encode("utf-8")

    assert len(serialized) < ASYNC_PAYLOAD_LIMIT_BYTES
