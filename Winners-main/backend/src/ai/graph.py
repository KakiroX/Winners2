from langgraph.graph import END, StateGraph

from src.ai.nodes import generate_schemas, handle_error, interpret_prompt, validate_schemas
from src.ai.state import FloorPlanGraphState


def _route_after_validation(state: FloorPlanGraphState) -> str:
    if state.get("validated_schemas"):
        return "done"
    if state.get("parse_attempts", 0) >= 3:
        return "error"
    return "retry"


def build_floor_plan_graph() -> StateGraph:  # type: ignore[type-arg]
    graph: StateGraph[FloorPlanGraphState] = StateGraph(FloorPlanGraphState)  # type: ignore[type-arg]

    graph.add_node("interpret_prompt", interpret_prompt)
    graph.add_node("generate_schemas", generate_schemas)
    graph.add_node("validate_schemas", validate_schemas)
    graph.add_node("handle_error", handle_error)

    graph.set_entry_point("interpret_prompt")

    graph.add_edge("interpret_prompt", "generate_schemas")
    graph.add_edge("generate_schemas", "validate_schemas")

    graph.add_conditional_edges(
        "validate_schemas",
        _route_after_validation,
        {
            "retry": "generate_schemas",
            "error": "handle_error",
            "done": END,
        },
    )
    graph.add_edge("handle_error", END)

    return graph.compile()
