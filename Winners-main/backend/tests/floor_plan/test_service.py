from unittest.mock import AsyncMock, patch

import pytest

from src.floor_plan.schemas import FloorPlanSchema, GenerateFloorPlanResponse
from src.floor_plan.service import FloorPlanService


def _make_schema(variant: str) -> FloorPlanSchema:
    return FloorPlanSchema(
        id="test-id",
        variant_label=variant,
        total_area_sqm=80.0,
        grid_cols=6,
        grid_rows=5,
        rooms=[],
        style_notes="Test rationale.",
        aesthetic_tags=["minimalist"],
    )


@pytest.mark.asyncio
async def test_generate_returns_response() -> None:
    mock_state = {
        "validated_schemas": [_make_schema("Open Flow"), _make_schema("Compact"), _make_schema("Split Layout")],
        "prompt_interpretation": "A compact apartment.",
        "generation_id": "test-gen-id",
    }

    with patch("src.floor_plan.service.build_floor_plan_graph") as mock_build:
        mock_graph = AsyncMock()
        mock_graph.ainvoke.return_value = mock_state
        mock_build.return_value = mock_graph

        response = await FloorPlanService.generate("3 bedroom apartment with natural light")

    assert isinstance(response, GenerateFloorPlanResponse)
    assert len(response.schemas) == 3
    assert response.generation_id == "test-gen-id"
