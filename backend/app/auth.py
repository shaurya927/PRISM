"""Clerk sign-in for the investigator API.

The public website, /health, /media and the sample reports stay open. Everything that touches
uploaded footage needs a signed-in Clerk user: /api/* (except the OpenAPI docs) and /artifacts/*.

The browser sends the Clerk session token as `Authorization: Bearer <jwt>` (api.js) or, for <img>
and download links, in the `__session` cookie that Clerk sets on the site's domain. The token is a
short-lived RS256 JWT; it is verified against the instance's public JWKS, so no network call is made
per request once the keys are cached.

Auth is off when CLERK_PUBLISHABLE_KEY is not set (local development, tests).
"""

from __future__ import annotations

import base64
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

log = logging.getLogger("prism.auth")

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_API = ("/api/docs", "/api/openapi.json")
PROTECTED = ("/api/", "/artifacts/")


def _load_env() -> None:
    """Read KEY=VALUE pairs from the git-ignored .env at the repo root (real env vars win)."""
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - python-dotenv is optional
        return
    load_dotenv(ROOT / ".env", override=False)


_load_env()


def publishable_key() -> str:
    return os.environ.get("CLERK_PUBLISHABLE_KEY", "").strip()


def enabled() -> bool:
    return bool(publishable_key()) and os.environ.get("PRISM_AUTH", "on").lower() != "off"


@lru_cache(maxsize=1)
def frontend_api() -> str:
    """pk_test_<base64("inspired-werewolf-426.clerk.accounts.dev$")> -> the instance host."""
    pk = publishable_key()
    encoded = pk.split("_", 2)[-1]
    encoded += "=" * (-len(encoded) % 4)
    host = base64.b64decode(encoded).decode().rstrip("$")
    if not host or "/" in host:
        raise ValueError("CLERK_PUBLISHABLE_KEY does not decode to a Clerk host")
    return host


@lru_cache(maxsize=1)
def _jwks():
    import jwt

    return jwt.PyJWKClient(f"https://{frontend_api()}/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def needs_auth(path: str) -> bool:
    if path.startswith(PUBLIC_API):
        return False
    return path.startswith(PROTECTED)


def verify(token: str) -> Optional[dict]:
    """Claims of a valid Clerk session token, or None."""
    import jwt

    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token, key, algorithms=["RS256"], issuer=f"https://{frontend_api()}",
            options={"require": ["exp", "iat", "sub"]}, leeway=10,
        )
    except Exception as exc:  # invalid, expired, wrong issuer, JWKS unreachable
        log.info("rejected Clerk token: %s", exc.__class__.__name__)
        return None


def token_from(headers, cookies) -> Optional[str]:
    auth = headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return cookies.get("__session") or None
