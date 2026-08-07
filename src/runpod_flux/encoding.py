import base64
from io import BytesIO

from PIL import Image

from runpod_flux.constants import MAX_BASE64_CHARACTERS
from runpod_flux.contracts import EncodedImage
from runpod_flux.errors import OutputEncodingError


def encode_png(image: Image.Image) -> EncodedImage:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    payload = buffer.getvalue()
    encoded = base64.b64encode(payload).decode("ascii")
    if len(encoded) > MAX_BASE64_CHARACTERS:
        raise OutputEncodingError("Generated image exceeds the response size limit")
    return EncodedImage(data=encoded, byte_count=len(payload))

