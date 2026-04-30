import asyncio
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import docker
import docker.errors
from fastapi import WebSocket

from app.config import settings
from app.services.level_loader import get_workspace_seed_files


@dataclass
class SessionState:
    session_id: str
    user_id: str
    level_id: str
    container: docker.models.containers.Container
    workspace_path: Path
    phase: str = "idle"  # idle | inited | planned | applied | destroyed
    last_activity: datetime = field(default_factory=datetime.utcnow)
    websocket: Optional[WebSocket] = None


class SessionManager:
    def __init__(self):
        self._sessions: dict[str, SessionState] = {}
        self._docker: docker.DockerClient | None = None
        self._cleanup_task: asyncio.Task | None = None

    def _get_docker(self) -> docker.DockerClient:
        if self._docker is None:
            self._docker = docker.from_env()
        return self._docker

    async def start_cleanup_task(self):
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self):
        while True:
            await asyncio.sleep(60)
            await self._cleanup_stale()

    async def _cleanup_stale(self):
        cutoff = datetime.utcnow() - timedelta(minutes=settings.session_timeout_minutes)
        stale = [sid for sid, s in self._sessions.items() if s.last_activity < cutoff]
        for sid in stale:
            await self.terminate_session(sid)

    def get_session(self, session_id: str) -> SessionState | None:
        return self._sessions.get(session_id)

    def count_user_sessions(self, user_id: str) -> int:
        return sum(1 for s in self._sessions.values() if s.user_id == user_id)

    async def create_session(self, level_id: str, user_id: str) -> SessionState:
        if self.count_user_sessions(user_id) >= settings.max_sessions_per_user:
            raise RuntimeError(f"Max {settings.max_sessions_per_user} concurrent sessions per user")

        session_id = str(uuid.uuid4())
        workspace_path = Path(settings.workspace_base_dir) / session_id / "workspace"
        workspace_path.mkdir(parents=True, exist_ok=True)

        # Write permissive terraformrc so providers download directly from registry
        (workspace_path / ".terraformrc").write_text(
            'provider_installation {\n  direct {}\n}\n'
        )

        # Seed level files into workspace
        for filename, content in get_workspace_seed_files(level_id).items():
            (workspace_path / filename).write_text(content)

        loop = asyncio.get_event_loop()
        container = await loop.run_in_executor(None, self._create_container, workspace_path)

        session = SessionState(
            session_id=session_id,
            user_id=user_id,
            level_id=level_id,
            container=container,
            workspace_path=workspace_path,
        )
        self._sessions[session_id] = session
        return session

    def _create_container(self, workspace_path: Path) -> docker.models.containers.Container:
        client = self._get_docker()
        workspace_host = str(workspace_path.resolve())

        # Ensure workspace is writable by any container user
        workspace_path.chmod(0o777)

        container = client.containers.run(
            image=settings.sandbox_image,
            entrypoint=["/bin/sh", "-c", "sleep infinity"],
            detach=True,
            volumes={workspace_host: {"bind": "/workspace", "mode": "rw"}},
            mem_limit="256m",
            memswap_limit="256m",
            cpu_period=100000,
            cpu_quota=25000,
            pids_limit=64,
            environment={
                "TF_CLI_ARGS": "-no-color",
                "TF_IN_AUTOMATION": "1",
                "TF_CLI_CONFIG_FILE": "/workspace/.terraformrc",
            },
            working_dir="/workspace",
        )

        # Verify the container actually started
        container.reload()
        if container.status != "running":
            logs = container.logs().decode("utf-8", errors="replace")
            container.remove(force=True)
            raise RuntimeError(f"Container failed to start. Logs: {logs}")

        return container

    async def terminate_session(self, session_id: str):
        session = self._sessions.pop(session_id, None)
        if not session:
            return

        loop = asyncio.get_event_loop()

        def _stop():
            try:
                session.container.stop(timeout=5)
                session.container.remove(force=True)
            except docker.errors.DockerException:
                pass

        await loop.run_in_executor(None, _stop)

        session_root = session.workspace_path.parent
        if session_root.exists():
            shutil.rmtree(session_root, ignore_errors=True)

    async def terminate_all_sessions(self):
        session_ids = list(self._sessions.keys())
        for sid in session_ids:
            await self.terminate_session(sid)

    def touch(self, session_id: str):
        session = self._sessions.get(session_id)
        if session:
            session.last_activity = datetime.utcnow()


session_manager = SessionManager()
