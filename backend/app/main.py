from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.base import init_db
from app.routers import sessions, users, websocket
from app.services.session_manager import session_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await session_manager.start_cleanup_task()
    yield
    await session_manager.terminate_all_sessions()


app = FastAPI(title="Terraformageddon API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(sessions.router)
app.include_router(users.router)
app.include_router(websocket.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
