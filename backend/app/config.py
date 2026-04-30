from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import json


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: List[str] = ["http://localhost:5500", "http://127.0.0.1:5500"]

    auth_disabled: bool = True

    azure_tenant_name: str = ""
    azure_tenant_id: str = ""
    azure_client_id: str = ""
    azure_b2c_flow: str = "B2C_1_susi"

    database_url: str = "sqlite+aiosqlite:///./terraformageddon.db"

    sandbox_image: str = "terraformageddon-sandbox:latest"
    session_timeout_minutes: int = 15
    workspace_base_dir: str = "/tmp/tg-sessions"

    max_sessions_per_user: int = 3
    max_runs_per_minute: int = 30
    max_workspace_size_mb: int = 50

    @property
    def jwks_uri(self) -> str:
        return (
            f"https://{self.azure_tenant_name}.b2clogin.com/"
            f"{self.azure_tenant_name}.onmicrosoft.com/"
            f"{self.azure_b2c_flow}/discovery/v2.0/keys"
        )


settings = Settings()
