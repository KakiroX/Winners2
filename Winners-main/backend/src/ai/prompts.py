from langchain_core.prompts import ChatPromptTemplate

INTERPRET_PROMPT_TEMPLATE = ChatPromptTemplate.from_messages([
    ("system", """You are an expert architectural space planner.
Interpret the user's natural language description of a living space and produce a clear,
structured summary of their requirements.

Extract and state explicitly:
- Number and types of rooms requested
- Approximate total area if mentioned (infer if not)
- Desired spatial style (open plan, suite-first, compact, split, etc.)
- Special features: home office, en-suite, natural light priority, island kitchen, etc.
- Adjacency preferences: which rooms should be next to which

Respond in 2-3 concise sentences. Be specific. Do not invent requirements not implied by the prompt."""),
    ("human", "{prompt}"),
])

GENERATE_SCHEMAS_TEMPLATE = ChatPromptTemplate.from_messages([
    ("system", """You are a generative floor plan architect.
Based on the interpreted space requirements, generate exactly 3 or 4 distinct floor plan layout variants.

Rules:
- Each variant must have a unique spatial logic with a label: "Open Flow", "Split Layout", "Compact", or "Suite-First"
- Rooms use grid-based positioning with integer grid units (NOT pixels or meters)
- Rooms that are adjacent must share an edge — connections[] must reflect real geometry
- grid_cols and grid_rows must contain all rooms without overflow
- area_sqm values must sum to approximately total_area_sqm
- aesthetic_tags are style seeds for downstream image generation — be specific (e.g. "japandi", "warm minimalist")
- style_notes is 1 sentence of design rationale shown to the user on the selection card
- Each room MUST have a unique string id (use short slugs like "living-room-1", "bedroom-1", etc.)
- connections[] must reference other rooms by their id field

Respond with ONLY valid JSON — no markdown fences, no explanation, no preamble:
{{
  "schemas": [
    {{
      "variant_label": "Open Flow",
      "total_area_sqm": 85,
      "grid_cols": 6,
      "grid_rows": 5,
      "style_notes": "One sentence rationale.",
      "aesthetic_tags": ["open plan", "minimalist", "natural light"],
      "rooms": [
        {{
          "id": "living-room-1",
          "type": "living_room",
          "label": "Living Room",
          "area_sqm": 28,
          "width_units": 4,
          "height_units": 3,
          "position": {{"x": 0, "y": 0}},
          "connections": ["kitchen-1"],
          "features": ["window_south", "open_to_next"],
          "natural_light": "high"
        }}
      ]
    }}
  ]
}}

This is attempt number {attempt}. If attempt > 0, vary the spatial logic more aggressively."""),
    ("human", "Space requirements:\n{interpretation}"),
])
