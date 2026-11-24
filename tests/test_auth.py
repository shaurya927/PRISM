"""Clerk sign-in gate: which paths are protected, key decoding and token checks (no network)."""
import base64
import datetime as dt

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from backend.app import auth

HOST = "inspired-werewolf-426.clerk.accounts.dev"
PK = "pk_test_" + base64.b64encode(f"{HOST}$".encode()).decode().rstrip("=")


@pytest.fixture
def clerk_on(monkeypatch):
    monkeypatch.setenv("CLERK_PUBLISHABLE_KEY", PK)
    monkeypatch.setenv("PRISM_AUTH", "on")
    auth.frontend_api.cache_clear()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            return type("K", (), {"key": key.public_key()})()

    monkeypatch.setattr(auth, "_jwks", lambda: FakeJWKS())
    yield key
    auth.frontend_api.cache_clear()


def _token(key, iss=f"https://{HOST}", minutes=5):
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode({"sub": "user_123", "iss": iss, "iat": now, "exp": now + dt.timedelta(minutes=minutes)},
                      key, algorithm="RS256")


def test_publishable_key_decodes_to_the_clerk_host(clerk_on):
    assert auth.frontend_api() == HOST


def test_only_footage_routes_need_sign_in():
    for p in ("/api/jobs", "/api/jobs/abc/rescore", "/api/search", "/api/report/x", "/artifacts/run/a.png"):
        assert auth.needs_auth(p), p
    for p in ("/", "/app", "/health", "/media/highway.mp4", "/reports/index.html", "/api/docs", "/api/openapi.json"):
        assert not auth.needs_auth(p), p


def test_token_checks(clerk_on):
    assert auth.verify(_token(clerk_on))["sub"] == "user_123"
    assert auth.verify(_token(clerk_on, minutes=-5)) is None              # expired
    assert auth.verify(_token(clerk_on, iss="https://evil.example")) is None  # another instance
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert auth.verify(_token(other)) is None                             # wrong signing key


def test_api_rejects_missing_token_and_accepts_bearer_or_cookie(clerk_on):
    from backend.app.main import app

    c = TestClient(app)
    assert c.get("/health").status_code == 200
    assert c.get("/api/jobs").status_code == 401
    tok = _token(clerk_on)
    assert c.get("/api/jobs", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    c.cookies.set("__session", tok)
    assert c.get("/api/jobs").status_code == 200


def test_auth_is_off_without_a_key(monkeypatch):
    monkeypatch.delenv("CLERK_PUBLISHABLE_KEY", raising=False)
    assert not auth.enabled()
