from __future__ import annotations

from argparse import ArgumentParser, Namespace
from dataclasses import asdict, is_dataclass
from typing import Any
import json

from .client import create_client
from .config import LiquidSettings, load_settings


class LiquidCliError(Exception):
    pass


def to_jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    return value


def ensure_live_execution_allowed(
    *, execute: bool, settings: LiquidSettings
) -> None:
    if execute and not settings.live_trading_enabled:
        raise LiquidCliError(
            "Live execution is disabled. Set LIQUID_ENABLE_LIVE_TRADING=1 and rerun with --execute."
        )


def build_order_payload(args: Namespace) -> dict[str, Any]:
    order_type = args.type.lower()
    if order_type != "market" and args.price is None:
        raise LiquidCliError("Limit-style orders require --price.")

    payload = {
        "symbol": args.symbol,
        "side": args.side,
        "type": order_type,
        "size": args.size,
        "leverage": args.leverage,
        "price": args.price,
        "tp": args.tp,
        "sl": args.sl,
        "reduce_only": args.reduce_only,
        "time_in_force": args.time_in_force,
    }

    return payload


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(prog="python -m liquid")
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="Connectivity and auth smoke test")
    doctor.add_argument("--symbol", default="BTC-PERP")

    ticker = subparsers.add_parser("ticker", help="Fetch one ticker")
    ticker.add_argument("symbol")

    markets = subparsers.add_parser("markets", help="List markets")
    markets.add_argument("--limit", type=int, default=20)

    subparsers.add_parser("account", help="Fetch account balances and equity")
    subparsers.add_parser("positions", help="Fetch open positions")

    place_order = subparsers.add_parser("place-order", help="Preview or place an order")
    place_order.add_argument("--symbol", required=True)
    place_order.add_argument("--side", required=True, choices=("buy", "sell"))
    place_order.add_argument("--type", default="market")
    place_order.add_argument("--size", required=True, type=float)
    place_order.add_argument("--leverage", type=int, default=1)
    place_order.add_argument("--price", type=float)
    place_order.add_argument("--tp", type=float)
    place_order.add_argument("--sl", type=float)
    place_order.add_argument("--reduce-only", action="store_true")
    place_order.add_argument("--time-in-force", default="gtc")
    place_order.add_argument("--execute", action="store_true")

    return parser


def run(args: Namespace) -> Any:
    settings = load_settings()

    if args.command == "place-order":
        payload = build_order_payload(args)
        if not args.execute:
            return {"mode": "dry-run", "payload": payload}

        ensure_live_execution_allowed(execute=True, settings=settings)

        client = create_client(settings)
        try:
            return client.place_order(**payload)
        finally:
            client.close()

    client = create_client(settings)
    try:
        if args.command == "doctor":
            ticker = client.get_ticker(args.symbol)
            return {
                "status": "ok",
                "symbol": args.symbol,
                "mark_price": ticker.mark_price,
                "volume_24h": ticker.volume_24h,
            }
        if args.command == "ticker":
            return client.get_ticker(args.symbol)
        if args.command == "markets":
            return client.get_markets()[: args.limit]
        if args.command == "account":
            return client.get_account()
        if args.command == "positions":
            return client.get_positions()
    finally:
        client.close()

    raise LiquidCliError(f"Unsupported command: {args.command}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        result = run(args)
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": error.__class__.__name__,
                    "message": str(error),
                },
                indent=2,
            )
        )
        return 1

    print(json.dumps(to_jsonable(result), indent=2))
    return 0
