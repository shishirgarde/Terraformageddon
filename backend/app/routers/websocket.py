import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.auth_service import validate_token
from app.services.level_loader import check_success_condition
from app.services.session_manager import session_manager
from app.services.terraform_runner import run_terraform

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/sessions/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str, token: str = ""):
    await websocket.accept()

    try:
        user = await validate_token(token)
    except Exception:
        await websocket.send_json({"type": "error", "message": "Unauthorized"})
        await websocket.close(code=4001)
        return

    session = session_manager.get_session(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close(code=4004)
        return

    if session.user_id != user.id:
        await websocket.send_json({"type": "error", "message": "Forbidden"})
        await websocket.close(code=4003)
        return

    session.websocket = websocket
    await websocket.send_json({"type": "connected", "session_id": session_id})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "ping":
                session_manager.touch(session_id)
                await websocket.send_json({"type": "pong"})
                continue

            if msg.get("type") == "run":
                command = msg.get("command")
                if command not in {"init", "plan", "apply", "destroy"}:
                    await websocket.send_json({"type": "error", "message": f"Unknown command: {command}"})
                    continue

                hcl_content = msg.get("hcl_content")
                if hcl_content is not None:
                    main_tf = session.workspace_path / "main.tf"
                    main_tf.write_text(hcl_content)

                await websocket.send_json({"type": "started", "command": command})

                async def send_line(line: str):
                    await websocket.send_json({"type": "output", "line": line})

                result = await run_terraform(session.container, command, send_line)

                # Check level success after apply
                mission_success = False
                if command == "apply" and result.success:
                    mission_success = check_success_condition(session.workspace_path, session.level_id)
                    if mission_success:
                        session.phase = "applied"

                if command == "destroy" and result.success:
                    session.phase = "destroyed"

                result_payload = result.model_dump()
                result_payload["mission_success"] = mission_success

                await websocket.send_json({
                    "type": "done",
                    "command": command,
                    "exit_code": 0 if result.success else 1,
                    "result": result_payload,
                })

                session_manager.touch(session_id)

    except WebSocketDisconnect:
        session.websocket = None
