import json
import asyncio
from pathlib import Path
from typing import AsyncIterator, Callable, Awaitable
import docker
import docker.models.containers

from app.schemas.session import TerraformResult, TerraformError

# Commands that use -json flag for machine-readable output
JSON_COMMANDS = {"plan", "apply", "validate"}
# terraform destroy doesn't support -json in older versions; use -auto-approve only
DESTROY_FLAGS = ["-auto-approve"]
PLAN_FLAGS = ["-json"]
APPLY_FLAGS = ["-json", "-auto-approve"]
INIT_FLAGS = ["-no-color", "-upgrade"]
VALIDATE_FLAGS = ["-json"]
FMT_FLAGS = ["-diff", "-no-color"]

ALLOWED_TERRAFORM_SUBCOMMANDS = {"init", "plan", "apply", "destroy", "validate", "fmt"}


def _build_terraform_cmd(command: str) -> list[str]:
    if command == "init":
        return ["terraform", "init"] + INIT_FLAGS
    elif command == "plan":
        return ["terraform", "plan"] + PLAN_FLAGS
    elif command == "apply":
        return ["terraform", "apply"] + APPLY_FLAGS
    elif command == "destroy":
        return ["terraform", "destroy"] + DESTROY_FLAGS
    elif command == "validate":
        return ["terraform", "validate"] + VALIDATE_FLAGS
    elif command == "fmt":
        return ["terraform", "fmt"] + FMT_FLAGS
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


# ───────────────────────────────────────────────────────────────
# Sandboxed shell helpers — used by Level 2 interactive terminal.
# Strict whitelist; no shell interpolation; no path traversal.
# ───────────────────────────────────────────────────────────────

ALLOWED_SHELL_COMMANDS = {"ls", "cat"}


def _safe_relative_path(arg: str) -> str | None:
    """Return arg if it's a safe relative path inside /workspace, else None."""
    if not arg:
        return None
    if arg.startswith("/") or arg.startswith("~"):
        return None
    # Reject any segment that is exactly `..` (path traversal)
    parts = arg.replace("\\", "/").split("/")
    if any(p == ".." for p in parts):
        return None
    # Reject shell metacharacters
    if any(c in arg for c in [";", "&", "|", "`", "$", "\n", "\r", "*", "?", "<", ">", "(", ")"]):
        return None
    return arg


def build_shell_argv(cmd: str, args: list[str]) -> list[str] | None:
    """Validate `cmd args...` against the whitelist. Returns argv or None if rejected."""
    if cmd not in ALLOWED_SHELL_COMMANDS:
        return None

    if cmd == "ls":
        # Accept either no args (list /workspace) or a single safe relative path
        if not args:
            return ["ls", "-la", "--color=never"]
        if len(args) == 1:
            safe = _safe_relative_path(args[0])
            if safe is None:
                return None
            return ["ls", "-la", "--color=never", safe]
        return None

    if cmd == "cat":
        if len(args) != 1:
            return None
        safe = _safe_relative_path(args[0])
        if safe is None:
            return None
        return ["cat", safe]

    return None


async def run_shell_command(
    container: docker.models.containers.Container,
    argv: list[str],
    on_line: Callable[[str], Awaitable[None]],
) -> TerraformResult:
    """Execute a whitelisted shell command inside the container, streaming output."""
    loop = asyncio.get_event_loop()

    def _exec():
        container.reload()
        if container.status != "running":
            raise RuntimeError(f"Container is not running (status: {container.status})")
        return container.exec_run(argv, workdir="/workspace", stream=True, demux=False)

    exec_result = await loop.run_in_executor(None, _exec)
    output_lines: list[str] = []
    for chunk in exec_result.output:
        text = chunk.decode("utf-8", errors="replace")
        output_lines.append(text)
        await on_line(text)

    # exec_run streaming doesn't surface exit code; treat as success unless output
    # is empty after a cat (file likely missing — but cat itself prints to stderr)
    return TerraformResult(success=True, changes=None, errors=None)
