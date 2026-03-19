from fastapi import APIRouter, Depends, status

from src.floor_plan.dependencies import sanitize_prompt
from src.floor_plan.schemas import GenerateFloorPlanResponse
from src.floor_plan.service import FloorPlanService

router = APIRouter(prefix="/floor-plan", tags=["floor-plan"])


@router.post(
    "/generate",
    response_model=GenerateFloorPlanResponse,
    status_code=status.HTTP_200_OK,
    description="Generate 3–4 floor plan schema variants from a natural language prompt.",
    responses={
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Prompt too short, too long, or flagged"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "Gemini API unavailable or timed out"},
    },
)
async def generate_floor_plan(
    prompt: str = Depends(sanitize_prompt),
) -> GenerateFloorPlanResponse:
    return await FloorPlanService.generate(prompt)
