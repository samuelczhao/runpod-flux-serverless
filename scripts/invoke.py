import argparse
import base64
import json
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import requests

type JsonObject = dict[str, object]

API_BASE = "https://api.runpod.ai/v2/{endpoint_id}"
DEFAULT_INPUT_PATH = Path("test_input.json")
DEFAULT_OUTPUT_PATH = Path("generated.png")
DEFAULT_POLL_SECONDS = 2.0
DEFAULT_TIMEOUT_SECONDS = 900
REQUEST_TIMEOUT_SECONDS = 30
MIN_SYNC_WAIT_MILLISECONDS = 1_000
MAX_SYNC_WAIT_MILLISECONDS = 300_000
MILLISECONDS_PER_SECOND = 1_000
SYNC_RESPONSE_BUFFER_SECONDS = 30
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TERMINAL_STATUSES = frozenset({"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"})
ACTIVE_STATUSES = frozenset({"IN_QUEUE", "IN_PROGRESS"})


class ClientError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Options:
    input_path: Path
    output_path: Path
    sync: bool
    timeout_seconds: int


def main() -> int:
    try:
        options = _parse_options()
        job_input = _read_json(options.input_path)
        endpoint_id = _required_environment("RUNPOD_ENDPOINT_ID")
        api_key = _required_environment("RUNPOD_API_KEY")
        response = _invoke(endpoint_id, api_key, job_input, options)
        _save_image(response, options.output_path)
    except (ClientError, OSError, requests.RequestException) as error:
        print(f"error: {error}")
        return 1
    print(f"saved {options.output_path}")
    return 0


def _parse_options() -> Options:
    parser = argparse.ArgumentParser(description="Invoke the Runpod FLUX endpoint")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--sync", action="store_true")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args()
    timeout = cast(int, args.timeout)
    if timeout <= 0:
        parser.error("--timeout must be positive")
    return Options(cast(Path, args.input), cast(Path, args.output), cast(bool, args.sync), timeout)


def _read_json(path: Path) -> JsonObject:
    try:
        value: object = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ClientError(f"invalid JSON in {path}: {error.msg}") from error
    return _json_object(value, f"input file {path}")


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ClientError(f"{name} is not set")
    return value


def _invoke(
    endpoint_id: str,
    api_key: str,
    job_input: JsonObject,
    options: Options,
) -> JsonObject:
    if options.sync:
        return _invoke_sync(endpoint_id, api_key, job_input, options.timeout_seconds)
    submitted = _post(endpoint_id, api_key, "run", job_input)
    job_id = _string_field(submitted, "id")
    print(f"submitted job {job_id}")
    return _poll(endpoint_id, api_key, job_id, options.timeout_seconds)


def _invoke_sync(
    endpoint_id: str,
    api_key: str,
    job_input: JsonObject,
    timeout_seconds: int,
) -> JsonObject:
    deadline = time.monotonic() + timeout_seconds
    wait_ms = _sync_wait_milliseconds(timeout_seconds)
    request_timeout = math.ceil(wait_ms / MILLISECONDS_PER_SECOND) + SYNC_RESPONSE_BUFFER_SECONDS
    response = _post(endpoint_id, api_key, f"runsync?wait={wait_ms}", job_input, request_timeout)
    if response.get("status") not in ACTIVE_STATUSES:
        return _require_completed(response)
    job_id = _string_field(response, "id")
    return _poll(endpoint_id, api_key, job_id, _remaining_seconds(deadline, job_id))


def _post(
    endpoint_id: str,
    api_key: str,
    route: str,
    job_input: JsonObject,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> JsonObject:
    response = requests.post(
        f"{API_BASE.format(endpoint_id=endpoint_id)}/{route}",
        headers=_headers(api_key),
        data=json.dumps(job_input),
        timeout=timeout,
    )
    response.raise_for_status()
    return _response_json(response)


def _poll(endpoint_id: str, api_key: str, job_id: str, timeout: int) -> JsonObject:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = requests.get(
            f"{API_BASE.format(endpoint_id=endpoint_id)}/status/{job_id}",
            headers=_headers(api_key),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        result = _response_json(response)
        status = result.get("status")
        if status in TERMINAL_STATUSES:
            return _require_completed(result)
        if status not in ACTIVE_STATUSES:
            raise ClientError(f"job {job_id} returned unknown status {status}")
        time.sleep(DEFAULT_POLL_SECONDS)
    raise ClientError(f"job {job_id} did not finish within {timeout} seconds")


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _sync_wait_milliseconds(timeout_seconds: int) -> int:
    requested = timeout_seconds * MILLISECONDS_PER_SECOND
    return min(max(requested, MIN_SYNC_WAIT_MILLISECONDS), MAX_SYNC_WAIT_MILLISECONDS)


def _remaining_seconds(deadline: float, job_id: str) -> int:
    remaining = math.ceil(deadline - time.monotonic())
    if remaining <= 0:
        raise ClientError(f"job {job_id} did not finish within the client timeout")
    return remaining


def _response_json(response: requests.Response) -> JsonObject:
    try:
        value: object = response.json()
    except requests.JSONDecodeError as error:
        raise ClientError("Runpod returned invalid JSON") from error
    return _json_object(value, "Runpod response")


def _json_object(value: object, source: str) -> JsonObject:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ClientError(f"{source} must be a JSON object")
    return cast(JsonObject, value)


def _require_completed(response: JsonObject) -> JsonObject:
    status = response.get("status")
    if status != "COMPLETED":
        error = response.get("error", "no error detail")
        raise ClientError(f"job ended with status {status}: {error}")
    output = response.get("output")
    return _json_object(output, "completed job output")


def _string_field(value: JsonObject, field: str) -> str:
    result = value.get(field)
    if not isinstance(result, str) or not result:
        raise ClientError(f"Runpod response is missing {field}")
    return result


def _save_image(output: JsonObject, path: Path) -> None:
    encoded = _string_field(output, "image_base64")
    try:
        image = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise ClientError("Runpod output contains invalid base64") from error
    if not image.startswith(PNG_SIGNATURE):
        raise ClientError("Runpod output is not a PNG image")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(image)


if __name__ == "__main__":
    raise SystemExit(main())
