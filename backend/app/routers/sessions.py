from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.dependencies import get_current_user
from app.schemas.session import RunCommand, SessionCreate, SessionResponse
from app.services.auth_service import AuthUser
from app.services.level_loader import get_level_config, get_starter_code
from app.services.session_manager import session_manager

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(body: SessionCreate, request: Request, current_user: AuthUser = Depends(get_current_user)):
    try:
        get_level_config(body.level_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Level '{body.level_id}' not found")

    try:
        session = await session_manager.create_session(body.level_id, current_user.id)
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail=str(e))

    base_url = str(request.base_url).rstrip("/")
    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
    ws_url += f"/ws/sessions/{session.session_id}"

    return SessionResponse(
        session_id=session.session_id,
        level_id=session.level_id,
        starter_code=get_starter_code(body.level_id),
        ws_url=ws_url,
    )


@router.post("/{session_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_command(
    session_id: str,
    body: RunCommand,
    current_user: AuthUser = Depends(get_current_user),
):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    allowed_commands = {"init", "plan", "apply", "destroy"}
    if body.command not in allowed_commands:
        raise HTTPException(status_code=400, detail=f"Command must be one of {allowed_commands}")

    if body.hcl_content is not None:
        # Check workspace size before writing
        workspace_size_mb = sum(
            f.stat().st_size for f in session.workspace_path.rglob("*") if f.is_file()
        ) / (1024 * 1024)
        from app.config import settings
        if workspace_size_mb > settings.max_workspace_size_mb:
            raise HTTPException(status_code=400, detail="Workspace size limit exceeded")

        main_tf = session.workspace_path / "main.tf"
        main_tf.write_text(body.hcl_content)

    session_manager.touch(session_id)
    return {"status": "accepted", "command": body.command}


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session_id: str, current_user: AuthUser = Depends(get_current_user)):
    session = session_manager.get_session(session_id)
    if session and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    await session_manager.terminate_session(session_id)
