from typing import NotRequired, TypedDict

from src.floor_plan.schemas import FloorPlanSchema


class FloorPlanGraphState(TypedDict):
    raw_prompt: str
    generation_id: str

    prompt_interpretation: NotRequired[str]
    raw_llm_output: NotRequired[str]
    parse_attempts: NotRequired[int]

    validated_schemas: NotRequired[list[FloorPlanSchema]]
    error: NotRequired[str]
