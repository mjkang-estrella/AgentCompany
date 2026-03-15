from __future__ import annotations

from argparse import Namespace
import unittest

from liquid.cli import LiquidCliError, build_order_payload, ensure_live_execution_allowed
from liquid.config import LiquidSettings


class CliTests(unittest.TestCase):
    def test_build_order_payload_requires_price_for_limit_orders(self) -> None:
        args = Namespace(
            symbol="BTC-PERP",
            side="buy",
            type="limit",
            size=25.0,
            leverage=2,
            price=None,
            tp=None,
            sl=None,
            reduce_only=False,
            time_in_force="gtc",
        )

        with self.assertRaisesRegex(LiquidCliError, "require --price"):
            build_order_payload(args)

    def test_build_order_payload_allows_market_orders(self) -> None:
        args = Namespace(
            symbol="BTC-PERP",
            side="buy",
            type="market",
            size=25.0,
            leverage=2,
            price=None,
            tp=120000.0,
            sl=90000.0,
            reduce_only=False,
            time_in_force="gtc",
        )

        payload = build_order_payload(args)
        self.assertEqual(payload["type"], "market")
        self.assertEqual(payload["size"], 25.0)

    def test_live_execution_guard_blocks_when_env_flag_is_off(self) -> None:
        settings = LiquidSettings(
            api_key="lq_test",
            api_secret="sk_test",
            live_trading_enabled=False,
        )

        with self.assertRaisesRegex(LiquidCliError, "Live execution is disabled"):
            ensure_live_execution_allowed(execute=True, settings=settings)

    def test_live_execution_guard_allows_when_enabled(self) -> None:
        settings = LiquidSettings(
            api_key="lq_test",
            api_secret="sk_test",
            live_trading_enabled=True,
        )

        ensure_live_execution_allowed(execute=True, settings=settings)


if __name__ == "__main__":
    unittest.main()
