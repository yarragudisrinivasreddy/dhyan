"""
exceptions.py — Custom exceptions for Dhyan.
"""


class GemmaConnectionError(Exception):
    """Raised when LM Studio is unreachable."""
    pass


class GemmaResponseError(Exception):
    """Raised when Gemma returns an unparseable response."""
    pass


class InvalidImageError(Exception):
    """Raised when the uploaded image is malformed or too large."""
    pass
