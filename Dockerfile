FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime@sha256:6acf597eeb8e376a96580dde4952f37cc017fef732bb40bfc73f28f25e3f64b4

ARG UV_VERSION=0.10.11

ENV DIFFUSERS_OFFLINE=1 \
    HF_ENABLE_PARALLEL_LOADING=YES \
    HF_HUB_CACHE=/runpod-volume/huggingface-cache/hub \
    HF_HUB_OFFLINE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    TRANSFORMERS_OFFLINE=1 \
    UV_NO_CACHE=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN python -c "import torch; assert torch.__version__.split('+')[0] == '2.13.0'" \
    && python -m pip install --break-system-packages "uv==${UV_VERSION}" \
    && uv export --frozen --no-dev --no-emit-project --prune torch \
        --format requirements-txt --output-file /tmp/requirements.lock \
    && uv pip install --system --break-system-packages --require-hashes \
        --requirements /tmp/requirements.lock \
    && python -m pip uninstall --yes --break-system-packages uv \
    && rm /tmp/requirements.lock \
    && python -m pip check \
    && python -c "import torch; assert torch.__version__.split('+')[0] == '2.13.0'; assert torch.version.cuda == '12.6'" \
    && python -c "import accelerate, runpod, transformers; from diffusers import FluxPipeline"

COPY handler.py ./
COPY src ./src

CMD ["python", "-u", "handler.py"]
