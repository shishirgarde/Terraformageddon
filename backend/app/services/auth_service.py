import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db.base import AsyncSessionLocal
from app.models.user import User


@dataclass
class AuthUser:
    id: str
    azure_oid: str
    email: str
    display_name: str


DEV_USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$")


def _normalize_dev_username(token: str) -> str:
    """Extract a dev username from bearer token text.

    Accepted forms:
    - username:alice
    - alice
    Empty/invalid values fall back to dev-user for backwards compatibility.
    """
    candidate = token.strip() or "dev-user"
    if ":" in candidate:
        prefix, value = candidate.split(":", 1)
        if prefix.lower() == "username":
            candidate = value.strip()
    candidate = candidate.strip().lower()
    if not DEV_USERNAME_PATTERN.match(candidate):
        return "dev-user"
    return candidate


async def _get_or_create_dev_user(username: str) -> AuthUser:
    azure_oid = f"dev:{username}"
    email = f"{username}@dev.local"

    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(User).where(User.azure_oid == azure_oid))
        user = existing.scalar_one_or_none()

        if user is None:
            user = User(
                azure_oid=azure_oid,
                email=email,
                display_name=username,
                last_seen=datetime.utcnow(),
            )
            db.add(user)
            try:
                await db.commit()
                await db.refresh(user)
            except IntegrityError:
                # Another request created the same user concurrently.
                await db.rollback()
                retry = await db.execute(select(User).where(User.azure_oid == azure_oid))
                user = retry.scalar_one()
        else:
            user.last_seen = datetime.utcnow()
            if not user.display_name:
                user.display_name = username
            if not user.email:
                user.email = email
            await db.commit()

    return AuthUser(
        id=user.id,
        azure_oid=user.azure_oid,
        email=user.email or "",
        display_name=user.display_name or username,
    )


async def validate_token(token: str) -> AuthUser:
    """
    Phase 1: AUTH_DISABLED=true returns a hardcoded dev user.
    Phase 2: Validate JWT against Azure AD B2C JWKS endpoint.
    """
    if settings.auth_disabled:
        username = _normalize_dev_username(token)
        return await _get_or_create_dev_user(username)

    # Phase 2 implementation:
    # from jose import jwt, JWTError
    # from httpx import AsyncClient
    # Fetch JWKS from settings.jwks_uri, verify signature, extract claims
    raise NotImplementedError("Auth not yet configured — set AUTH_DISABLED=true for development")
