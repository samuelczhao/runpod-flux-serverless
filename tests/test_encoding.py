import base64
from io import BytesIO

import pytest
from PIL import Image

from runpod_flux import encoding
from runpod_flux.errors import OutputEncodingError


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
