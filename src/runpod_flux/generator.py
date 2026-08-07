from typing import Protocol, cast

import torch
from diffusers import FluxPipeline
from PIL import Image

from runpod_flux.constants import MAX_SEQUENCE_LENGTH
from runpod_flux.contracts import GenerationRequest, ModelSnapshot
from runpod_flux.errors import InferenceError


class _PipelineOutput(Protocol):
    @property
    def images(self) -> list[Image.Image] | object: ...


class _FluxRuntime(Protocol):
    def set_progress_bar_config(self, *, disable: bool) -> None: ...

    def __call__(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        guidance_scale: float,
        num_inference_steps: int,
        max_sequence_length: int,
        generator: torch.Generator,
        output_type: str,
    ) -> _PipelineOutput: ...


class FluxImageGenerator:
    def __init__(self, pipeline: _FluxRuntime, revision: str) -> None:
        self._pipeline = pipeline
        self._revision = revision

    @property
    def revision(self) -> str:
        return self._revision

    @classmethod
    def load(cls, snapshot: ModelSnapshot) -> "FluxImageGenerator":
        _require_cuda()
        pipeline = cast(
            _FluxRuntime,
            FluxPipeline.from_pretrained(  # type: ignore[no-untyped-call]
                snapshot.path,
                torch_dtype=torch.bfloat16,
                device_map="cuda",
                local_files_only=True,
                use_safetensors=True,
            ),
        )
        pipeline.set_progress_bar_config(disable=True)
        return cls(pipeline, snapshot.revision)

    def generate(self, request: GenerationRequest) -> Image.Image:
        generator = torch.Generator("cpu").manual_seed(request.seed)
        with torch.inference_mode():
            output = self._pipeline(
                prompt=request.prompt,
                width=request.width,
                height=request.height,
                guidance_scale=request.guidance_scale,
                num_inference_steps=request.num_inference_steps,
                max_sequence_length=MAX_SEQUENCE_LENGTH,
                generator=generator,
                output_type="pil",
            )
        return _first_image(output.images)


def cuda_metadata() -> dict[str, object]:
    _require_cuda()
    properties = torch.cuda.get_device_properties(0)
    return {
        "gpu": properties.name,
        "gpu_memory_gb": round(properties.total_memory / (1024**3), 1),
        "cuda_version": torch.version.cuda,
        "bfloat16_supported": torch.cuda.is_bf16_supported(),
    }


def _require_cuda() -> None:
    if not torch.cuda.is_available():
        raise InferenceError("CUDA GPU is required")
    if not torch.cuda.is_bf16_supported():
        raise InferenceError("The selected GPU must support bfloat16")


def _first_image(images: list[Image.Image] | object) -> Image.Image:
    if not isinstance(images, list) or not images:
        raise InferenceError("FLUX returned no image")
    image = images[0]
    if not isinstance(image, Image.Image):
        raise InferenceError("FLUX returned an unexpected image type")
    return image
