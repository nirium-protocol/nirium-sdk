"""FastAPI x402 decorator for Nirium SDK v0.7.0+.

Provides a reusable decorator `@x402_required(price="0.02")` that
validates `X-402-Signature` headers against the nirium settlement service
and returns HTTP 402 Payment Required when no valid signature is provided.
"""
from .decorator import x402_required, X402Config, X402ValidationResult

__all__ = ["x402_required", "X402Config", "X402ValidationResult"]
__version__ = "0.7.0"