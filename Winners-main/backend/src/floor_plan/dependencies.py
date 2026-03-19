from fastapi import Body

from src.floor_plan.constants import PROMPT_INJECTION_PATTERNS
from src.floor_plan.exceptions import PromptRejectedError
from src.floor_plan.schemas import GenerateFloorPlanRequest


async def sanitize_prompt(body: GenerateFloorPlanRequest = Body()) -> str:
    lower = body.prompt.lower()
    for pattern in PROMPT_INJECTION_PATTERNS:
        if pattern in lower:
            raise PromptRejectedError(f"Prompt contains disallowed content: '{pattern}'")
    return body.prompt
