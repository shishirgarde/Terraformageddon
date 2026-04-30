from pydantic import BaseModel
from typing import Optional


class SessionCreate(BaseModel):
    level_id: str = "level1"


class SessionResponse(BaseModel):
    session_id: str
    level_id: str
    starter_code: str
    ws_url: str


class RunCommand(BaseModel):
    command: str  # init | plan | apply | destroy
    hcl_content: Optional[str] = None


class TerraformError(BaseModel):
    summary: str
    detail: str = ""


class TerraformResult(BaseModel):
    success: bool
    changes: Optional[dict] = None   # {"add": 1, "change": 0, "destroy": 0}
    errors: Optional[list[TerraformError]] = None
    resource_address: Optional[str] = None


class ProgressUpdate(BaseModel):
    level_id: str
    xp_earned: int = 0
    chaos_score: int = 0
    chaos_events: int = 0
    time_secs: Optional[int] = None
    completed: bool = False
