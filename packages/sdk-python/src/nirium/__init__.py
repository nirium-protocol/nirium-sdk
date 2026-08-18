"""Nirium — Official Python SDK for the Nirium autonomous DeFi agent."""

from .client import Agent, WebSocketMaxRetriesExceeded, WebSocketStatus  # type: ignore

__version__ = "0.9.0"
__all__ = ["Agent", "WebSocketMaxRetriesExceeded", "WebSocketStatus"]
