# Liquid

Minimal Python trading workspace for a Liquid account, based on the official Quickstart:

- Quickstart: <https://sdk.tryliquid.xyz/docs/quickstart>
- SDK reference: <https://sdk.tryliquid.xyz/docs/sdk>
- REST API reference: <https://sdk.tryliquid.xyz/docs/api-reference>

## What this sets up

- Local env template for `LIQUID_API_KEY` and `LIQUID_API_SECRET`
- Thin `LiquidClient` loader
- Safe CLI commands for connectivity, markets, account, and positions
- Order placement support with a two-step live-trading gate

## Before you use it

The Quickstart requires these account-side steps first:

1. Create your Liquid account at `app.tryliquid.xyz`
2. Deposit USDC
3. Click **Enable Trading**
4. Generate API keys at `app.tryliquid.xyz/account/api-keys`

The docs say your API key looks like `lq_...` and your API secret looks like `sk_...`. The secret is shown once and should not be committed.

## Environment

Copy the template and fill in your credentials:

```bash
cp liquid/.env.example liquid/.env
```

The scripts load environment values from:

1. OS environment variables
2. `liquid/.env`
3. repo root `.env`

Values closer to the top take precedence.

## Install

This repo already has a local `.venv`. To install from the pinned requirements:

```bash
.venv/bin/python -m pip install -r liquid/requirements.txt
```

## Usage

Safe read-only checks:

```bash
.venv/bin/python -m liquid doctor
.venv/bin/python -m liquid ticker BTC-PERP
.venv/bin/python -m liquid markets --limit 10
.venv/bin/python -m liquid account
.venv/bin/python -m liquid positions
```

Order preview:

```bash
.venv/bin/python -m liquid place-order \
  --symbol BTC-PERP \
  --side buy \
  --type market \
  --size 25 \
  --leverage 2
```

Live order execution requires both:

1. `LIQUID_ENABLE_LIVE_TRADING=1` in your environment
2. `--execute` on the command

Example:

```bash
LIQUID_ENABLE_LIVE_TRADING=1 \
.venv/bin/python -m liquid place-order \
  --symbol BTC-PERP \
  --side buy \
  --type market \
  --size 25 \
  --leverage 2 \
  --execute
```

## Notes

- `size` is USD notional, matching the Quickstart.
- `tp` and `sl` are optional.
- Limit orders require `--price`.
- This setup does not auto-trade by default.
