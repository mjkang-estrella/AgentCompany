from __future__ import annotations

import unittest

from liquid.config import build_settings, parse_bool, parse_dotenv_text


class ConfigTests(unittest.TestCase):
    def test_parse_dotenv_text_ignores_comments_and_strips_quotes(self) -> None:
        values = parse_dotenv_text(
            """
            # comment
            LIQUID_API_KEY="lq_test"
            LIQUID_API_SECRET='sk_test'
            LIQUID_TIMEOUT=45
            """
        )

        self.assertEqual(values["LIQUID_API_KEY"], "lq_test")
        self.assertEqual(values["LIQUID_API_SECRET"], "sk_test")
        self.assertEqual(values["LIQUID_TIMEOUT"], "45")

    def test_build_settings_requires_credentials(self) -> None:
        with self.assertRaisesRegex(ValueError, "LIQUID_API_KEY is required"):
            build_settings({}, require_credentials=True)

    def test_build_settings_parses_optional_values(self) -> None:
        settings = build_settings(
            {
                "LIQUID_API_KEY": "lq_test",
                "LIQUID_API_SECRET": "sk_test",
                "LIQUID_BASE_URL": "https://example.test",
                "LIQUID_TIMEOUT": "12.5",
                "LIQUID_MAX_RETRIES": "3",
                "LIQUID_ENABLE_LIVE_TRADING": "1",
            }
        )

        self.assertEqual(settings.api_key, "lq_test")
        self.assertEqual(settings.api_secret, "sk_test")
        self.assertEqual(settings.base_url, "https://example.test")
        self.assertEqual(settings.timeout, 12.5)
        self.assertEqual(settings.max_retries, 3)
        self.assertTrue(settings.live_trading_enabled)

    def test_parse_bool_defaults_false(self) -> None:
        self.assertFalse(parse_bool(None))
        self.assertFalse(parse_bool("0"))
        self.assertTrue(parse_bool("true"))


if __name__ == "__main__":
    unittest.main()
