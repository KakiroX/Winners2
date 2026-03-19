import uuid

from src.ai.graph import build_floor_plan_graph
from src.ai.state import FloorPlanGraphState
from src.floor_plan.schemas import GenerateFloorPlanResponse


class FloorPlanService:
    @staticmethod
    async def generate(prompt: str) -> GenerateFloorPlanResponse:
        graph = build_floor_plan_graph()
        initial_state = FloorPlanGraphState(
            raw_prompt=prompt,
            generation_id=str(uuid.uuid4()),
        )
        final_state = await graph.ainvoke(initial_state)
        return GenerateFloorPlanResponse(
            schemas=final_state["validated_schemas"],
            prompt_interpretation=final_state["prompt_interpretation"],
            generation_id=final_state["generation_id"],
        )
