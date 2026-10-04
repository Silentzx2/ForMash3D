"""Smart intent resolution API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.dependencies import get_current_settings
from core.smart_presets import load_smart_presets, resolve_intent

router = APIRouter(prefix="/smart-generation", tags=["Smart Generation"])


class IntentResolveRequest(BaseModel):
    intent: str = Field(..., min_length=1)
    model: str | None = None


@router.get("/presets")
async def presets():
    data = load_smart_presets()
    return {"version": int(data.get("version", 1)), "intents": data["intents"]}


@router.post("/resolve")
async def resolve(
    request: IntentResolveRequest,
    settings=Depends(get_current_settings),
):
    try:
        return resolve_intent(
            request.intent,
            settings,
            explicit_model=request.model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
