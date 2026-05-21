import asyncio
import json
import shlex

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.auth_service import validate_token
from app.services.level_loader import check_success_condition
from app.services.session_manager import session_manager
from app.services.terraform_runner import (
    ALLOWED_TERRAFORM_SUBCOMMANDS,
    build_shell_argv,
    run_shell_command,
    run_terraform,
)

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

            if msg.get("type") == "save":
                hcl_content = msg.get("hcl_content")
                if isinstance(hcl_content, str):
                    main_tf = session.workspace_path / "main.tf"
                    main_tf.write_text(hcl_content)
                    session_manager.touch(session_id)
                    await websocket.send_json({"type": "saved"})
                continue

            if msg.get("type") == "cmd":
                # Interactive terminal: parse a free-form command line.
                line = (msg.get("line") or "").strip()
                if not line:
                    continue

                # Echo the typed line back so it appears in the scrollback.
                await websocket.send_json({"type": "output", "line": f"$ {line}\n"})

                try:
                    tokens = shlex.split(line)
                except ValueError as e:
                    await websocket.send_json({"type": "output", "line": f"parse error: {e}\n"})
                    await websocket.send_json({"type": "done", "command": "unknown", "exit_code": 1, "result": {"success": False, "mission_success": False}})
                    continue

                if not tokens:
                    continue

                head = tokens[0]

                # ── terraform <subcmd> ──
                if head == "terraform":
                    if len(tokens) < 2 or tokens[1] not in ALLOWED_TERRAFORM_SUBCOMMANDS:
                        allowed = ", ".join(sorted(ALLOWED_TERRAFORM_SUBCOMMANDS))
                        await websocket.send_json({"type": "output", "line": f"unknown or disallowed terraform subcommand. allowed: {allowed}\n"})
                        await websocket.send_json({"type": "done", "command": "unknown", "exit_code": 1, "result": {"success": False, "mission_success": False}})
                        continue

                    subcommand = tokens[1]

                    # Save the editor's current content if provided alongside the cmd
                    hcl_content = msg.get("hcl_content")
                    if isinstance(hcl_content, str):
                        (session.workspace_path / "main.tf").write_text(hcl_content)

                    await websocket.send_json({"type": "started", "command": subcommand})

                    async def send_line(line_text: str):
                        await websocket.send_json({"type": "output", "line": line_text})

                    result = await run_terraform(session.container, subcommand, send_line)

                    mission_success = False
                    if subcommand == "apply" and result.success:
                        mission_success = check_success_condition(session.workspace_path, session.level_id)
                        if mission_success:
                            session.phase = "applied"

                    if subcommand == "destroy" and result.success:
                        session.phase = "destroyed"

                    result_payload = result.model_dump()
                    result_payload["mission_success"] = mission_success

                    await websocket.send_json({
                        "type": "done",
                        "command": subcommand,
                        "exit_code": 0 if result.success else 1,
                        "result": result_payload,
                    })

                    session_manager.touch(session_id)
                    continue

                # ── whitelisted shell commands ──
                argv = build_shell_argv(head, tokens[1:])
                if argv is None:
                    await websocket.send_json({"type": "output", "line": f"command not allowed: {line}\n"})
                    await websocket.send_json({"type": "done", "command": "unknown", "exit_code": 1, "result": {"success": False, "mission_success": False}})
                    continue

                await websocket.send_json({"type": "started", "command": head})

                async def send_shell_line(line_text: str):
                    await websocket.send_json({"type": "output", "line": line_text})

                result = await run_shell_command(session.container, argv, send_shell_line)
                await websocket.send_json({
                    "type": "done",
                    "command": head,
                    "exit_code": 0 if result.success else 1,
                    "result": {"success": result.success, "mission_success": False},
                })
                session_manager.touch(session_id)
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
