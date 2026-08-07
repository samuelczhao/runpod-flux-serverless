import json
import logging

LOGGER = logging.getLogger("runpod_flux")


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")


def log_event(event: str, *, level: int = logging.INFO, **fields: object) -> None:
    payload = json.dumps({"event": event, **fields}, default=str, sort_keys=True)
    LOGGER.log(level, payload)


def log_exception(event: str, **fields: object) -> None:
    payload = json.dumps({"event": event, **fields}, default=str, sort_keys=True)
    LOGGER.exception(payload)

