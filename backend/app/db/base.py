import time
from threading import Lock

from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Azure Database for PostgreSQL AAD token scope
_AAD_PG_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"


class _AadTokenProvider:
    """Fetches and caches AAD access tokens for PostgreSQL.

    Uses DefaultAzureCredential so the same code path works for:
    - Managed Identity when deployed to Azure (system or user-assigned)
    - `az login` developer credentials when running locally
    """

    def __init__(self, client_id: str = ""):
        self._client_id = client_id or None
        self._credential = None
        self._token = None
        self._expires_on = 0
        self._lock = Lock()

    def _ensure_credential(self):
        if self._credential is None:
            # Imported lazily so non-AAD setups don't require azure-identity at import time.
            from azure.identity import DefaultAzureCredential

            if self._client_id:
                self._credential = DefaultAzureCredential(
                    managed_identity_client_id=self._client_id
                )
            else:
                self._credential = DefaultAzureCredential()

    def get_token(self) -> str:
        # Refresh ~5 minutes before expiry to avoid mid-connection failures.
        now = int(time.time())
        if self._token and (self._expires_on - now) > 300:
            return self._token

        with self._lock:
            if self._token and (self._expires_on - int(time.time())) > 300:
                return self._token
            self._ensure_credential()
            token = self._credential.get_token(_AAD_PG_SCOPE)
            self._token = token.token
            self._expires_on = token.expires_on
            return self._token


engine = create_async_engine(settings.sqlalchemy_database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


if settings.use_aad_db_auth:
    _token_provider = _AadTokenProvider(settings.azure_db_client_id)

    @event.listens_for(engine.sync_engine, "do_connect")
    def _inject_aad_token(dialect, conn_rec, cargs, cparams):
        # asyncpg accepts password via cparams; replace each new connection's
        # password with a fresh AAD access token.
        cparams["password"] = _token_provider.get_token()


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
