from __future__ import annotations

from liquidtrading import LiquidClient

from .config import LiquidSettings, load_settings


def create_client(settings: LiquidSettings | None = None) -> LiquidClient:
    settings = settings or load_settings()

    kwargs = {
        "api_key": settings.api_key,
        "api_secret": settings.api_secret,
        "timeout": settings.timeout,
        "max_retries": settings.max_retries,
    }

    if settings.base_url:
        kwargs["base_url"] = settings.base_url

    return LiquidClient(**kwargs)
