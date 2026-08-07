from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from PIL import Image

type JsonObject = dict[str, object]


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    prompt: str
    seed: int
    width: int
    height: int
    num_inference_steps: int
    guidance_scale: float


@dataclass(frozen=True, slots=True)
class ModelSnapshot:
    path: Path
    revision: str


@dataclass(frozen=True, slots=True)
class EncodedImage:
    data: str
    byte_count: int


class ImageGenerator(Protocol):
    @property
    def revision(self) -> str: ...

    def generate(self, request: GenerationRequest) -> Image.Image: ...

