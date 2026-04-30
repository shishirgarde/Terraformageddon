import uuid
from dataclasses import dataclass

from app.config import settings


@dataclass
class AuthUser:
    id: str
    azure_oid: str
    email: str
    display_name: str


DEV_USER = AuthUser(
    id="dev-user-id",
    azure_oid="dev-oid",
    email="dev@localhost",
    display_name="Dev User",
)


async def validate_token(token: str) -> AuthUser:
    """
    Phase 1: AUTH_DISABLED=true returns a hardcoded dev user.
    Phase 2: Validate JWT against Azure AD B2C JWKS endpoint.
    """
    if settings.auth_disabled:
        return DEV_USER

    # Phase 2 implementation:
    # from jose import jwt, JWTError
    # from httpx import AsyncClient
    # Fetch JWKS from settings.jwks_uri, verify signature, extract claims
    raise NotImplementedError("Auth not yet configured — set AUTH_DISABLED=true for development")
