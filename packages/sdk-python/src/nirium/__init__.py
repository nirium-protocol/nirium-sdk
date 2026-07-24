"""Nirium — Official Python SDK for the Nirium autonomous DeFi agent."""

from .client import Agent  # type: ignore
from .x402 import FacilitatorVerifier, PaymentVerifier, x402_required

__version__ = "0.6.1"
__all__ = ["Agent", "FacilitatorVerifier", "PaymentVerifier", "x402_required"]
