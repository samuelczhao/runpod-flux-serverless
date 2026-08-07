from pathlib import Path

MODEL_ID = "black-forest-labs/FLUX.1-dev"
DEFAULT_CACHE_ROOT = Path("/runpod-volume/huggingface-cache/hub")
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
DEFAULT_STEPS = 50
DEFAULT_GUIDANCE_SCALE = 3.5
MAX_SEQUENCE_LENGTH = 512
MIN_DIMENSION = 512
MAX_DIMENSION = 1024
DIMENSION_MULTIPLE = 16
MIN_STEPS = 1
MAX_STEPS = 50
MIN_GUIDANCE_SCALE = 0.0
MAX_GUIDANCE_SCALE = 10.0
MAX_PROMPT_LENGTH = 2_000
MAX_SEED = (2**63) - 1
MAX_BASE64_CHARACTERS = 8_000_000
ALLOWED_INPUT_FIELDS = frozenset(
    {
        "prompt",
        "seed",
        "width",
        "height",
        "num_inference_steps",
        "guidance_scale",
    }
)
