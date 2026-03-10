#!/usr/bin/env python3
"""
Extract likely login codes and magic links from raw email text or JSON.

Usage examples:
  cat thread.json | python3 scripts/extract_login_artifact.py
  python3 scripts/extract_login_artifact.py thread.json --prefer code
  python3 scripts/extract_login_artifact.py email.txt --prefer link
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

URL_RE = re.compile(r"https?://[^\s<>\"]+")
HTML_TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
CODE_KEYWORD_RE = re.compile(
    r"(verification code|login code|security code|one[- ]time code|passcode|otp|code)",
    re.IGNORECASE,
)
LINK_POSITIVE_RE = re.compile(
    r"(login|log-in|log_in|signin|sign-in|sign_in|verify|verification|magic|auth|authenticate|session|token)",
    re.IGNORECASE,
)
LINK_NEGATIVE_RE = re.compile(
    r"(unsubscribe|preferences|privacy|terms|support|help|view-in-browser|twitter|linkedin|facebook)",
    re.IGNORECASE,
)
STRONG_CODE_RE = re.compile(
    r"(?:verification code|login code|security code|one[- ]time code|passcode|otp|code)"
    r"[^A-Za-z0-9]{0,20}([A-Z0-9][A-Z0-9 -]{2,12}[A-Z0-9])",
    re.IGNORECASE,
)
GENERIC_CODE_RE = re.compile(r"\b[A-Z0-9]{4,10}\b")
STOP_WORDS = {
    "ABC123",
    "AGENTMAIL",
    "VERIFY",
    "LOGIN",
    "LOG",
    "SIGN",
    "INBOX",
    "EMAIL",
    "MAGIC",
    "LINK",
    "SECURITY",
    "ACCOUNT",
    "SUPPORT",
    "THREAD",
    "MESSAGE",
    "CLICK",
    "PLEASE",
    "HTTPS",
    "HTTP",
    "TOKEN",
    "EXAMPLE",
    "YOUR",
    "CODE",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", help="Optional input file. Defaults to stdin.")
    parser.add_argument(
        "--prefer",
        choices=["auto", "link", "code"],
        default="auto",
        help="Artifact type to prefer in the top-level result.",
    )
    return parser.parse_args()


def load_raw_text(path: str | None) -> str:
    if path:
        return Path(path).read_text(encoding="utf-8")
    return sys.stdin.read()


def normalize_text(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"(?is)<(script|style).*?>.*?</\\1>", " ", value)
    value = HTML_TAG_RE.sub(" ", value)
    return SPACE_RE.sub(" ", value).strip()


def flatten_strings(value: Any) -> list[str]:
    strings: list[str] = []
    if isinstance(value, str):
        strings.append(value)
    elif isinstance(value, dict):
        for child in value.values():
            strings.extend(flatten_strings(child))
    elif isinstance(value, list):
        for child in value:
            strings.extend(flatten_strings(child))
    return strings


def message_sort_key(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    for key in ("received_timestamp", "timestamp", "sent_timestamp", "created_at", "updated_at"):
        value = message.get(key)
        if isinstance(value, str):
            return value
    return ""


def collect_blobs(raw_text: str) -> list[dict[str, Any]]:
    blobs: list[dict[str, Any]] = []

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        parsed = None

    if parsed is None:
        cleaned = normalize_text(raw_text)
        if cleaned:
            blobs.append({"label": "raw_text", "weight": 1.0, "text": cleaned})
        return blobs

    blobs.append({"label": "json_root", "weight": 1.0, "text": normalize_text(" ".join(flatten_strings(parsed)))})

    if isinstance(parsed, dict):
        messages = parsed.get("messages")
        if isinstance(messages, list) and messages:
            ordered = sorted(messages, key=message_sort_key)
            latest = ordered[-1]
            latest_text = normalize_text(" ".join(flatten_strings(latest)))
            if latest_text:
                blobs.insert(0, {"label": "latest_message", "weight": 2.0, "text": latest_text})

        for key in ("text", "html", "body", "content", "snippet", "subject"):
            value = parsed.get(key)
            if isinstance(value, str):
                cleaned = normalize_text(value)
                if cleaned:
                    blobs.append({"label": key, "weight": 1.5 if key in {"text", "html", "body"} else 1.1, "text": cleaned})

    return [blob for blob in blobs if blob["text"]]


def dedupe_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        key = candidate["value"]
        current = merged.get(key)
        if current is None or candidate["score"] > current["score"]:
            merged[key] = candidate
        elif candidate["score"] == current["score"]:
            current["reasons"] = sorted(set(current["reasons"]) | set(candidate["reasons"]))
            current["sources"] = sorted(set(current["sources"]) | set(candidate["sources"]))
    return sorted(merged.values(), key=lambda item: (-item["score"], item["value"]))


def extract_links(blobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for blob in blobs:
        text = blob["text"]
        for match in URL_RE.finditer(text):
            url = match.group(0).rstrip(").,;!?")
            context_start = max(0, match.start() - 80)
            context_end = min(len(text), match.end() + 80)
            context = text[context_start:context_end]
            score = int(30 * blob["weight"])
            reasons = [f"found_in_{blob['label']}"]

            if LINK_POSITIVE_RE.search(url) or LINK_POSITIVE_RE.search(context):
                score += 60
                reasons.append("auth_keyword")
            if "token=" in url or "code=" in url or "verify" in url.lower():
                score += 25
                reasons.append("auth_parameter")
            if LINK_NEGATIVE_RE.search(url) or LINK_NEGATIVE_RE.search(context):
                score -= 80
                reasons.append("negative_keyword")

            candidates.append(
                {
                    "type": "link",
                    "value": url,
                    "score": score,
                    "reasons": reasons,
                    "sources": [blob["label"]],
                }
            )
    return dedupe_candidates(candidates)


def score_generic_code(value: str, context: str, weight: float) -> tuple[int, list[str]]:
    reasons: list[str] = []
    score = int(15 * weight)

    if CODE_KEYWORD_RE.search(context):
        score += 70
        reasons.append("keyword_context")

    if value.isdigit():
        if 4 <= len(value) <= 8:
            score += 20
            reasons.append("numeric_length")
        else:
            score -= 20
            reasons.append("numeric_length_outlier")
    else:
        if any(char.isdigit() for char in value) and any(char.isalpha() for char in value):
            score += 15
            reasons.append("mixed_alnum")
        if len(value) >= 6:
            score += 10
            reasons.append("long_alnum")

    if value in STOP_WORDS:
        score -= 100
        reasons.append("stop_word")

    digit_count = sum(char.isdigit() for char in value)
    if digit_count >= 4:
        score += 20
        reasons.append("digit_heavy")
    elif digit_count == 0:
        score -= 40
        reasons.append("no_digits")

    return score, reasons


def extract_codes(blobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for blob in blobs:
        text = blob["text"]
        text_without_urls = URL_RE.sub(" ", text)

        for match in STRONG_CODE_RE.finditer(text_without_urls):
            code = re.sub(r"[^A-Z0-9]", "", match.group(1).upper())
            if len(code) < 4 or len(code) > 10:
                continue
            score = int(85 * blob["weight"])
            reasons = [f"found_in_{blob['label']}", "strong_keyword_match"]
            candidates.append(
                {
                    "type": "code",
                    "value": code,
                    "score": score,
                    "reasons": reasons,
                    "sources": [blob["label"]],
                }
            )

        for match in GENERIC_CODE_RE.finditer(text_without_urls.upper()):
            code = match.group(0)
            if code in STOP_WORDS:
                continue
            context_start = max(0, match.start() - 50)
            context_end = min(len(text_without_urls), match.end() + 50)
            context = text_without_urls[context_start:context_end]
            score, reasons = score_generic_code(code, context, blob["weight"])
            if score < 30:
                continue
            candidates.append(
                {
                    "type": "code",
                    "value": code,
                    "score": score,
                    "reasons": [f"found_in_{blob['label']}"] + reasons,
                    "sources": [blob["label"]],
                }
            )

    return dedupe_candidates(candidates)


def choose_preferred(
    links: list[dict[str, Any]], codes: list[dict[str, Any]], prefer: str
) -> dict[str, Any] | None:
    best_link = links[0] if links else None
    best_code = codes[0] if codes else None

    if prefer == "link":
        return best_link or best_code
    if prefer == "code":
        return best_code or best_link

    if best_link and not best_code:
        return best_link
    if best_code and not best_link:
        return best_code
    if best_link and best_code:
        return best_link if best_link["score"] >= best_code["score"] else best_code
    return None


def main() -> int:
    args = parse_args()
    raw_text = load_raw_text(args.path)
    blobs = collect_blobs(raw_text)
    links = extract_links(blobs)
    codes = extract_codes(blobs)
    preferred = choose_preferred(links, codes, args.prefer)

    payload = {
        "preferred_artifact": preferred,
        "links": links[:10],
        "codes": codes[:10],
        "analyzed_sources": [blob["label"] for blob in blobs],
    }
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
