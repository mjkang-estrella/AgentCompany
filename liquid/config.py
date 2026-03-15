from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
import os


PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent


def _strip_wrapping_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_dotenv_text(text: str) -> dict[str, str]:
    values: dict[str, str] = {}

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = _strip_wrapping_quotes(value.strip())

    return values


def load_dotenv_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    return parse_dotenv_text(path.read_text(encoding="utf-8"))


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class LiquidSettings:
    api_key: str
    api_secret: str
    base_url: str | None = None
    timeout: float = 30.0
    max_retries: int = 0
    live_trading_enabled: bool = False


def build_settings(
    env: Mapping[str, str], *, require_credentials: bool = True
) -> LiquidSettings:
    api_key = env.get("LIQUID_API_KEY", "").strip()
    api_secret = env.get("LIQUID_API_SECRET", "").strip()

    if require_credentials:
        if not api_key:
            raise ValueError("LIQUID_API_KEY is required.")
        if not api_secret:
            raise ValueError("LIQUID_API_SECRET is required.")

    base_url = env.get("LIQUID_BASE_URL", "").strip() or None
    timeout = float(env.get("LIQUID_TIMEOUT", "30").strip() or "30")
    max_retries = int(env.get("LIQUID_MAX_RETRIES", "0").strip() or "0")
    live_trading_enabled = parse_bool(env.get("LIQUID_ENABLE_LIVE_TRADING"))

    return LiquidSettings(
        api_key=api_key,
        api_secret=api_secret,
        base_url=base_url,
        timeout=timeout,
        max_retries=max_retries,
        live_trading_enabled=live_trading_enabled,
    )


def load_settings(*, require_credentials: bool = True) -> LiquidSettings:
    merged: dict[str, str] = {}

    for path in (REPO_ROOT / ".env", PACKAGE_DIR / ".env"):
        merged.update(load_dotenv_file(path))

    merged.update(os.environ)
    return build_settings(merged, require_credentials=require_credentials)
