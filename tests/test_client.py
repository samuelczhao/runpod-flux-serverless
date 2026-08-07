import base64
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import invoke

PNG_BYTES = b"\x89PNG\r\n\x1a\ncontent"
REPOSITORY_ROOT = Path(__file__).parents[1]


def test_cli_help_runs_without_project_import_path() -> None:
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    completed = subprocess.run(
        [sys.executable, "scripts/invoke.py", "--help"],
        cwd=REPOSITORY_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert "Invoke the Runpod FLUX endpoint" in completed.stdout


def test_sync_falls_back_to_poll_for_running_job(monkeypatch: pytest.MonkeyPatch) -> None:
    polled: list[tuple[str, str, str, int]] = []
    monkeypatch.setattr(invoke, "_post", lambda *args: {"status": "IN_PROGRESS", "id": "job-1"})
    monkeypatch.setattr(invoke, "_poll", _poll_recorder(polled))

    output = invoke._invoke_sync("endpoint", "key", {"input": {}}, 900)

    assert output == {"image_base64": "encoded"}
    assert polled[0][:3] == ("endpoint", "key", "job-1")
    assert 0 < polled[0][3] <= 900


def test_sync_returns_completed_output(monkeypatch: pytest.MonkeyPatch) -> None:
    response = {"status": "COMPLETED", "output": {"image_base64": "encoded"}}
    monkeypatch.setattr(invoke, "_post", lambda *args: response)

    assert invoke._invoke_sync("endpoint", "key", {"input": {}}, 900) == response["output"]


@pytest.mark.parametrize("status", ["FAILED", "CANCELLED", "TIMED_OUT"])
def test_sync_rejects_terminal_failure(status: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(invoke, "_post", lambda *args: {"status": status, "error": "safe"})

    with pytest.raises(invoke.ClientError, match=status):
        invoke._invoke_sync("endpoint", "key", {"input": {}}, 900)


def test_rejects_completed_response_without_object_output() -> None:
    with pytest.raises(invoke.ClientError, match="completed job output"):
        invoke._require_completed({"status": "COMPLETED", "output": "not-an-object"})


def test_saves_valid_png(tmp_path: Path) -> None:
    output_path = tmp_path / "image.png"
    encoded = base64.b64encode(PNG_BYTES).decode("ascii")

    invoke._save_image({"image_base64": encoded}, output_path)

    assert output_path.read_bytes() == PNG_BYTES


@pytest.mark.parametrize("encoded", ["not-base64!", base64.b64encode(b"text").decode("ascii")])
def test_rejects_invalid_image(encoded: str, tmp_path: Path) -> None:
    with pytest.raises(invoke.ClientError):
        invoke._save_image({"image_base64": encoded}, tmp_path / "image.png")


def _poll_recorder(calls: list[tuple[str, str, str, int]]) -> object:
    def poll(endpoint_id: str, api_key: str, job_id: str, timeout: int) -> dict[str, object]:
        calls.append((endpoint_id, api_key, job_id, timeout))
        return {"image_base64": "encoded"}

    return poll
