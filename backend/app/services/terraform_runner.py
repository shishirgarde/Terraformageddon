import json
import asyncio
from pathlib import Path
from typing import AsyncIterator, Callable, Awaitable
import docker
import docker.models.containers

from app.schemas.session import TerraformResult, TerraformError

# Commands that use -json flag for machine-readable output
JSON_COMMANDS = {"plan", "apply"}
# terraform destroy doesn't support -json in older versions; use -auto-approve only
DESTROY_FLAGS = ["-auto-approve"]
PLAN_FLAGS = ["-json", "-out=tfplan"]
APPLY_FLAGS = ["-json", "-auto-approve"]
INIT_FLAGS = ["-no-color"]


def _build_terraform_cmd(command: str) -> list[str]:
    if command == "init":
        return ["terraform", "init"] + INIT_FLAGS
    elif command == "plan":
        return ["terraform", "plan"] + PLAN_FLAGS
    elif command == "apply":
        return ["terraform", "apply"] + APPLY_FLAGS
    elif command == "destroy":
        return ["terraform", "destroy"] + DESTROY_FLAGS
    raise ValueError(f"Unknown command: {command}")


def _parse_json_line(line: str) -> dict | None:
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def _extract_result(command: str, output_lines: list[str], exit_code: int) -> TerraformResult:
    """Parse collected -json output into a structured TerraformResult."""
    errors: list[TerraformError] = []
    changes: dict | None = None

    for line in output_lines:
        obj = _parse_json_line(line)
        if not obj:
            continue

        msg_type = obj.get("type", "")

        if msg_type == "diagnostic" and obj.get("@level") == "error":
            diag = obj.get("diagnostic", {})
            errors.append(TerraformError(
                summary=diag.get("summary", "Unknown error"),
                detail=diag.get("detail", ""),
            ))

        elif msg_type == "change_summary":
            c = obj.get("changes", {})
            changes = {
                "add": c.get("add", 0),
                "change": c.get("change", 0),
                "destroy": c.get("remove", 0),
            }

    success = exit_code == 0 and not errors
    return TerraformResult(success=success, changes=changes, errors=errors or None)


async def run_terraform(
    container: docker.models.containers.Container,
    command: str,
    on_line: Callable[[str], Awaitable[None]],
) -> TerraformResult:
    """
    Execute a terraform command inside the container, streaming each line to on_line().
    Returns a structured TerraformResult when complete.
    """
    cmd = _build_terraform_cmd(command)
    output_lines: list[str] = []

    # exec_run is synchronous; run in thread pool to avoid blocking the event loop
    loop = asyncio.get_event_loop()

    def _exec():
        container.reload()
        if container.status != "running":
            logs = container.logs().decode("utf-8", errors="replace")
            raise RuntimeError(f"Container is not running (status: {container.status}). Logs: {logs}")
        exec_result = container.exec_run(
            cmd,
            workdir="/workspace",
            stream=True,
            demux=False,
        )
        return exec_result

    exec_result = await loop.run_in_executor(None, _exec)
    exit_code = 0

    for chunk in exec_result.output:
        text = chunk.decode("utf-8", errors="replace")
        for line in text.splitlines(keepends=True):
            output_lines.append(line)
            # For JSON commands, send both raw line and also the human message field
            if command in JSON_COMMANDS:
                obj = _parse_json_line(line)
                if obj and obj.get("@message"):
                    await on_line(obj["@message"] + "\n")
                else:
                    await on_line(line)
            else:
                await on_line(line)

    # exec_run doesn't return exit code in streaming mode; re-exec to get it
    # We check for error indicators in the output instead
    if any("Error" in l or "error" in l for l in output_lines if not _parse_json_line(l) or _parse_json_line(l).get("@level") == "error"):
        exit_code = 1
    # More reliable: check for specific JSON error objects
    for line in output_lines:
        obj = _parse_json_line(line)
        if obj and obj.get("type") == "diagnostic" and obj.get("@level") == "error":
            exit_code = 1
            break

    return _extract_result(command, output_lines, exit_code)
