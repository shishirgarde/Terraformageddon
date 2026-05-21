from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import json
from urllib.parse import quote_plus


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

    # Azure PostgreSQL Flexible Server (passwordless / AAD auth)
    # DB_USER is the Azure AD principal name configured as a PG role
    # (e.g. user principal name, MI display name, or service principal name).
    # No password is stored — tokens are fetched via DefaultAzureCredential.
    database_url: str = ""
    db_host: str = ""
    db_port: int = 5432
    db_name: str = "terraformageddon"
    db_user: str = ""
    db_ssl_mode: str = "require"
    # Optional: client id of a user-assigned managed identity. Leave blank
    # for system-assigned MI in Azure, or for `az login` locally.
    azure_db_client_id: str = ""

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

    @property
    def sqlalchemy_database_url(self) -> str:
        # Prefer explicit DATABASE_URL when provided.
        if self.database_url:
            return self.database_url

        # Build a passwordless Azure PostgreSQL Flexible DSN. The password
        # is injected at connect-time via an AAD access token (see db/base.py).
        if self.db_host and self.db_user:
            user = quote_plus(self.db_user)
            db_name = quote_plus(self.db_name)
            return (
                f"postgresql+asyncpg://{user}@{self.db_host}:{self.db_port}/{db_name}"
                f"?ssl={self.db_ssl_mode}"
            )

        # Fallback keeps local bootstrapping possible if DB env vars are not set.
        return "sqlite+aiosqlite:///./terraformageddon.db"

    @property
    def use_aad_db_auth(self) -> bool:
        """True when we should fetch AAD tokens for PostgreSQL auth."""
        return bool(self.db_host and self.db_user) and not self.database_url


settings = Settings()
