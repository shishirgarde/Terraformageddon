from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.dependencies import get_current_user
from app.models.progress import UserProgress
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
async def get_progress(
    current_user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserProgress).where(UserProgress.user_id == current_user.id)
    )
    rows = result.scalars().all()

    levels = {}
    total_xp = 0
    for row in rows:
        total_xp += row.xp_earned
        levels[row.level_id] = {
            "completed": row.completed,
            "xp_earned": row.xp_earned,
            "chaos_score": row.chaos_score,
            "chaos_events": row.chaos_events,
            "time_secs": row.best_time_secs,
            "attempts": row.attempts,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }

    return {
        "user_id": current_user.id,
        "display_name": current_user.display_name,
        "total_xp": total_xp,
        "levels": levels,
    }


@router.patch("/me/progress")
async def update_progress(
    body: ProgressUpdate,
    current_user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing_result = await db.execute(
        select(UserProgress).where(
            UserProgress.user_id == current_user.id,
            UserProgress.level_id == body.level_id,
        )
    )
    progress = existing_result.scalar_one_or_none()

    if progress is None:
        progress = UserProgress(
            user_id=current_user.id,
            level_id=body.level_id,
            completed=body.completed,
            xp_earned=max(0, body.xp_earned),
            chaos_score=max(0, body.chaos_score),
            chaos_events=max(0, body.chaos_events),
            best_time_secs=body.time_secs,
            attempts=1,
            completed_at=datetime.utcnow() if body.completed else None,
        )
        db.add(progress)
    else:
        progress.attempts += 1
        progress.xp_earned = max(progress.xp_earned, max(0, body.xp_earned))
        progress.chaos_score = min(progress.chaos_score, max(0, body.chaos_score))
        progress.chaos_events = min(progress.chaos_events, max(0, body.chaos_events))
        if body.time_secs is not None:
            if progress.best_time_secs is None:
                progress.best_time_secs = body.time_secs
            else:
                progress.best_time_secs = min(progress.best_time_secs, body.time_secs)
        if body.completed:
            progress.completed = True
            if progress.completed_at is None:
                progress.completed_at = datetime.utcnow()

    await db.commit()

    return {
        "status": "ok",
        "level_id": body.level_id,
        "attempts": progress.attempts,
    }
