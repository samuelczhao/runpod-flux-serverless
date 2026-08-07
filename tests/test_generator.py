from typing import cast

import torch
from PIL import Image

from runpod_flux.contracts import GenerationRequest
from runpod_flux.generator import FluxImageGenerator, _FluxRuntime


class FakeOutput:
    def __init__(self, image: Image.Image) -> None:
        self.images = [image]


class FakePipeline:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def __call__(self, **arguments: object) -> FakeOutput:
        self.calls.append(arguments)
        return FakeOutput(Image.new("RGB", (512, 512)))


def test_passes_documented_flux_parameters_and_cpu_seed() -> None:
    pipeline = FakePipeline()
    generator = FluxImageGenerator(cast(_FluxRuntime, pipeline), "revision")

    image = generator.generate(_request())
    call = pipeline.calls[0]

    assert image.size == (512, 512)
    assert _arguments_without_generator(call) == _expected_arguments()
    assert isinstance(call["generator"], torch.Generator)
    assert cast(torch.Generator, call["generator"]).device.type == "cpu"
    assert cast(torch.Generator, call["generator"]).initial_seed() == 42


def test_uses_fresh_generator_for_each_request() -> None:
    pipeline = FakePipeline()
    generator = FluxImageGenerator(cast(_FluxRuntime, pipeline), "revision")

    generator.generate(_request())
    generator.generate(_request())

    first = cast(torch.Generator, pipeline.calls[0]["generator"])
    second = cast(torch.Generator, pipeline.calls[1]["generator"])
    assert first is not second
    assert first.initial_seed() == second.initial_seed() == 42


def _request() -> GenerationRequest:
    return GenerationRequest("a lighthouse", 42, 512, 512, 20, 3.5)


def _arguments_without_generator(call: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in call.items() if key != "generator"}


def _expected_arguments() -> dict[str, object]:
    return {
        "prompt": "a lighthouse",
        "width": 512,
        "height": 512,
        "guidance_scale": 3.5,
        "num_inference_steps": 20,
        "max_sequence_length": 512,
        "output_type": "pil",
    }
