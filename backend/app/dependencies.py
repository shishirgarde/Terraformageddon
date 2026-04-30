from fastapi import Header, HTTPException, status
from app.services.auth_service import AuthUser, validate_token


async def get_current_user(authorization: str = Header(default="")) -> AuthUser:
    token = authorization.removeprefix("Bearer ").strip()
    try:
        return await validate_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing token")
