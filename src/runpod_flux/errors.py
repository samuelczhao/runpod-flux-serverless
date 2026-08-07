class InputValidationError(ValueError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field
        self.message = message


class InferenceError(RuntimeError):
    pass


class ModelCacheError(RuntimeError):
    pass


class OutputEncodingError(RuntimeError):
    pass
