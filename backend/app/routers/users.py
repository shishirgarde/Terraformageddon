from fastapi import APIRouter, Depends
from app.dependencies import get_current_user
from app.services.auth_service import AuthUser
from app.schemas.session import ProgressUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me")
async def get_me(current_user: AuthUser = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "display_name": current_user.display_name,
    }


@router.get("/me/progress")
async def get_progress(current_user: AuthUser = Depends(get_current_user)):
    # Phase 1: return empty progress (no DB persistence yet)
    return {
        "user_id": current_user.id,
        "display_name": current_user.display_name,
        "total_xp": 0,
        "levels": {},
    }


@router.patch("/me/progress")
async def update_progress(body: ProgressUpdate, current_user: AuthUser = Depends(get_current_user)):
    # Phase 2: persist to DB. Phase 1: acknowledge without storing.
    return {"status": "ok", "level_id": body.level_id}
