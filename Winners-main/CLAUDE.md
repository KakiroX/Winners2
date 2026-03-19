# CLAUDE.md — Inhabit Platform
## Phase A: Prompt-to-Floor-Plan Schema Generation

> This is the living contract for every developer and AI agent working on this codebase.
> Read it fully before touching any file. Update it the moment reality diverges from what is written here.
> Current phase: **A (Floor Plan Generation)**. Phases B and C sections are stubs — do not implement them yet.

---

## What This Phase Does

User types a natural language description of a living space.
The system generates 3–4 structured floor plan schemas via a LangGraph pipeline backed by Gemini.
The frontend renders them as interactive 2D SVG plans.
The user selects one — that selection is the handoff point into Phase B.

Nothing else. No panoramas. No inpainting. No walkthroughs. Phase A only.

---

## Monorepo Structure

```
inhabit/
├── backend/           # FastAPI — Python 3.12
├── frontend/          # Next.js 15 — TypeScript
├── CLAUDE.md          # you are here
├── .env               # Shared env vars (never commit)
└── docker-compose.yml # Local dev orchestration
```

---

## Backend

### Stack

| Concern | Choice |
|---|---|
| Framework | FastAPI (async-first, all routes `async def`) |
| Language | Python 3.12 |
| AI Orchestration | LangGraph 0.2.x |
| LLM | Gemini 2.0 Flash via `langchain-google-genai` |
| Validation | Pydantic v2 (never v1 compat mode) |
| DB (Phase A) | None — stateless, no persistence yet |
| Package Manager | uv |
| Linter / Formatter | ruff |
| Type Checker | pyright (strict) |

### Project Structure (zhanymkanov domain-driven pattern)

Each domain owns its full vertical slice: router, schemas, service, dependencies, constants,
exceptions. Never import from one domain's internals into another — use shared `src/` modules only.

```
backend/
├── alembic/                        # DB migrations — empty in Phase A, scaffolded for Phase B
├── src/
│   │
│   ├── floor_plan/                 # Domain: floor plan generation (Phase A core)
│   │   ├── __init__.py
│   │   ├── router.py               # FastAPI APIRouter — POST /floor-plan/generate
│   │   ├── schemas.py              # Pydantic I/O models for this domain
│   │   ├── models.py               # SQLAlchemy models — stub only in Phase A
│   │   ├── service.py              # Orchestrates the LangGraph pipeline
│   │   ├── dependencies.py         # FastAPI Depends() — rate limit, prompt sanitizer
│   │   ├── constants.py            # MAX_ROOMS, GRID_SIZE, SUPPORTED_STYLES, etc.
│   │   ├── exceptions.py           # Domain-specific HTTP exceptions
│   │   └── utils.py                # Pure helpers: grid math, label formatting
│   │
│   ├── ai/                         # Domain: LangGraph pipeline & Gemini client
│   │   ├── __init__.py
│   │   ├── graph.py                # LangGraph StateGraph definition — the full pipeline
│   │   ├── nodes.py                # Individual graph node functions (one async fn each)
│   │   ├── state.py                # GraphState TypedDict — single source of truth
│   │   ├── prompts.py              # All system/user prompt templates (nowhere else)
│   │   ├── client.py               # Gemini client singleton via langchain-google-genai
│   │   ├── schemas.py              # Pydantic models for raw LLM output parsing
│   │   ├── constants.py            # MODEL_NAME, TEMPERATURE, MAX_RETRIES, TIMEOUT
│   │   ├── exceptions.py           # AITimeoutError, SchemaExtractionError, etc.
│   │   └── utils.py                # Token counting, response cleaning, retry helpers
│   │
│   ├── config.py                   # Global settings via pydantic-settings (reads .env)
│   ├── constants.py                # App-wide constants: API version, CORS origins
│   ├── exceptions.py               # Global exception handlers registered on the app
│   ├── dependencies.py             # Shared FastAPI dependencies (e.g. get_settings)
│   └── main.py                     # FastAPI app factory, router registration, lifespan
│
├── tests/
│   ├── floor_plan/
│   │   ├── test_router.py          # Integration tests with httpx AsyncClient
│   │   └── test_service.py         # Unit tests with mocked LangGraph
│   └── ai/
│       ├── test_graph.py           # Graph node unit tests
│       └── test_prompts.py         # Prompt output format assertions
│
├── pyproject.toml                  # uv-managed deps + ruff + pyright config
├── .env.example                    # Committed — shows required keys with empty values
└── Dockerfile
```

### Key File Contracts

#### `src/config.py`
```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Gemini
    google_api_key: str
    gemini_model: str = "gemini-2.0-flash"
    gemini_temperature: float = 0.7
    gemini_max_retries: int = 3

    # App
    environment: str = "local"          # local | staging | production
    cors_origins: list[str] = ["http://localhost:3000"]
    api_v1_prefix: str = "/api/v1"

settings = Settings()
```

#### `src/main.py`
```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.constants import ENVIRONMENT_SHOW_DOCS
from src.exceptions import register_exception_handlers
from src.floor_plan.router import router as floor_plan_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up Gemini client on startup
    from src.ai.client import get_gemini_client
    get_gemini_client()
    yield

app_config: dict = {"title": "Inhabit API", "lifespan": lifespan}
if settings.environment not in ENVIRONMENT_SHOW_DOCS:
    app_config["openapi_url"] = None

app = FastAPI(**app_config)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(floor_plan_router, prefix=settings.api_v1_prefix)
```

#### `src/floor_plan/schemas.py`

API boundary models. Internal AI parsing models live in `src/ai/schemas.py`.

```python
from pydantic import BaseModel, Field
from enum import StrEnum

class RoomType(StrEnum):
    LIVING_ROOM = "living_room"
    KITCHEN     = "kitchen"
    BEDROOM     = "bedroom"
    BATHROOM    = "bathroom"
    OFFICE      = "office"
    DINING_ROOM = "dining_room"
    HALLWAY     = "hallway"
    BALCONY     = "balcony"
    STORAGE     = "storage"

class RoomFeature(StrEnum):
    WINDOW_NORTH = "window_north"
    WINDOW_SOUTH = "window_south"
    WINDOW_EAST  = "window_east"
    WINDOW_WEST  = "window_west"
    EN_SUITE     = "en_suite"
    ISLAND       = "island"
    WALK_IN      = "walk_in"
    OPEN_TO_NEXT = "open_to_next"

class RoomSchema(BaseModel):
    id: str                          # stable UUID assigned by the pipeline
    type: RoomType
    label: str                       # Human label: "Master Bedroom", "Open Kitchen"
    area_sqm: float = Field(gt=0)
    width_units: int = Field(ge=2)   # Relative grid units — NOT pixels
    height_units: int = Field(ge=2)
    position: dict[str, int]         # {"x": 0, "y": 0} — top-left grid origin
    connections: list[str]           # IDs of directly adjacent rooms
    features: list[RoomFeature] = []
    natural_light: str               # "high" | "medium" | "low"

class FloorPlanSchema(BaseModel):
    id: str                          # UUID assigned server-side
    variant_label: str               # "Open Flow" | "Split Layout" | "Compact" | "Suite-First"
    total_area_sqm: float
    grid_cols: int
    grid_rows: int
    rooms: list[RoomSchema]
    style_notes: str                 # 1-2 sentence design rationale shown on card
    aesthetic_tags: list[str]        # Style DNA seed for Phase B

# Request / Response

class GenerateFloorPlanRequest(BaseModel):
    prompt: str = Field(min_length=10, max_length=500)

class GenerateFloorPlanResponse(BaseModel):
    schemas: list[FloorPlanSchema]   # Always 3–4 items
    prompt_interpretation: str       # What AI understood — show to user
    generation_id: str               # Trace ID for debugging
```

#### `src/floor_plan/router.py`
```python
from fastapi import APIRouter, Depends, status
from src.floor_plan.schemas import GenerateFloorPlanRequest, GenerateFloorPlanResponse
from src.floor_plan.service import FloorPlanService
from src.floor_plan.dependencies import sanitize_prompt

router = APIRouter(prefix="/floor-plan", tags=["floor-plan"])

@router.post(
    "/generate",
    response_model=GenerateFloorPlanResponse,
    status_code=status.HTTP_200_OK,
    description="Generate 3–4 floor plan schema variants from a natural language prompt.",
    responses={
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Prompt too short, too long, or flagged"},
        status.HTTP_503_SERVICE_UNAVAILABLE:  {"description": "Gemini API unavailable or timed out"},
    },
)
async def generate_floor_plan(
    body: GenerateFloorPlanRequest,
    prompt: str = Depends(sanitize_prompt),
) -> GenerateFloorPlanResponse:
    return await FloorPlanService.generate(prompt)
```

#### `src/floor_plan/service.py`
```python
from src.ai.graph import build_floor_plan_graph
from src.ai.state import FloorPlanGraphState
from src.floor_plan.schemas import GenerateFloorPlanResponse
import uuid

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
```

### LangGraph Pipeline (`src/ai/`)

#### `src/ai/state.py`
```python
from typing import TypedDict, NotRequired
from src.floor_plan.schemas import FloorPlanSchema

class FloorPlanGraphState(TypedDict):
    # inputs
    raw_prompt: str
    generation_id: str

    # intermediate
    prompt_interpretation: NotRequired[str]
    raw_llm_output: NotRequired[str]
    parse_attempts: NotRequired[int]

    # output
    validated_schemas: NotRequired[list[FloorPlanSchema]]
    error: NotRequired[str]
```

#### `src/ai/graph.py`
```python
from langgraph.graph import StateGraph, END
from src.ai.state import FloorPlanGraphState
from src.ai.nodes import interpret_prompt, generate_schemas, validate_schemas, handle_error

def build_floor_plan_graph() -> StateGraph:
    graph = StateGraph(FloorPlanGraphState)

    graph.add_node("interpret_prompt", interpret_prompt)
    graph.add_node("generate_schemas", generate_schemas)
    graph.add_node("validate_schemas", validate_schemas)
    graph.add_node("handle_error",     handle_error)

    graph.set_entry_point("interpret_prompt")

    graph.add_edge("interpret_prompt", "generate_schemas")
    graph.add_edge("generate_schemas", "validate_schemas")

    graph.add_conditional_edges(
        "validate_schemas",
        _route_after_validation,
        {
            "retry": "generate_schemas",  # Bad schema — retry (max 3 attempts)
            "error": "handle_error",      # Exhausted retries
            "done":  END,
        },
    )
    graph.add_edge("handle_error", END)

    return graph.compile()

def _route_after_validation(state: FloorPlanGraphState) -> str:
    if state.get("validated_schemas"):
        return "done"
    if state.get("parse_attempts", 0) >= 3:
        return "error"
    return "retry"
```

#### `src/ai/nodes.py`
```python
from src.ai.state import FloorPlanGraphState
from src.ai.client import get_gemini_client
from src.ai.prompts import INTERPRET_PROMPT_TEMPLATE, GENERATE_SCHEMAS_TEMPLATE
from src.ai.utils import parse_json_response
from src.floor_plan.schemas import FloorPlanSchema
import uuid

async def interpret_prompt(state: FloorPlanGraphState) -> dict:
    llm = get_gemini_client()
    chain = INTERPRET_PROMPT_TEMPLATE | llm
    result = await chain.ainvoke({"prompt": state["raw_prompt"]})
    return {"prompt_interpretation": result.content.strip()}

async def generate_schemas(state: FloorPlanGraphState) -> dict:
    llm = get_gemini_client()
    chain = GENERATE_SCHEMAS_TEMPLATE | llm
    result = await chain.ainvoke({
        "interpretation": state["prompt_interpretation"],
        "attempt": state.get("parse_attempts", 0),
    })
    return {
        "raw_llm_output": result.content,
        "parse_attempts": state.get("parse_attempts", 0) + 1,
    }

async def validate_schemas(state: FloorPlanGraphState) -> dict:
    try:
        data = parse_json_response(state["raw_llm_output"])
        schemas = [
            FloorPlanSchema(**{**s, "id": str(uuid.uuid4())})
            for s in data["schemas"]
        ]
        if not (3 <= len(schemas) <= 4):
            raise ValueError(f"Expected 3-4 schemas, got {len(schemas)}")
        return {"validated_schemas": schemas}
    except Exception as e:
        return {"error": str(e)}

async def handle_error(state: FloorPlanGraphState) -> dict:
    from src.floor_plan.exceptions import SchemaGenerationError
    raise SchemaGenerationError(
        f"Failed to generate valid floor plan after 3 attempts. "
        f"Last error: {state.get('error')}"
    )
```

#### `src/ai/client.py`
```python
from functools import lru_cache
from langchain_google_genai import ChatGoogleGenerativeAI
from src.config import settings

@lru_cache(maxsize=1)
def get_gemini_client() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        google_api_key=settings.google_api_key,
        temperature=settings.gemini_temperature,
        max_retries=settings.gemini_max_retries,
    )
```

#### `src/ai/prompts.py`

All prompts live here and ONLY here. Never write prompt strings in nodes, service, or anywhere else.

```python
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
          "type": "living_room",
          "label": "Living Room",
          "area_sqm": 28,
          "width_units": 4,
          "height_units": 3,
          "position": {{"x": 0, "y": 0}},
          "connections": ["kitchen"],
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
```

### Backend Rules

1. **All routes are `async def`.** No sync route handlers — ever.
2. **No business logic in `router.py`.** Routers call service methods only. One level of indirection.
3. **No LLM calls outside `src/ai/`.** If you need Gemini from a service, call it via the graph.
4. **All prompts in `src/ai/prompts.py`.** Not in nodes, not in service, not inline strings anywhere.
5. **Pydantic v2 only.** Use `.model_dump()` not `.dict()`. Use `model_config` not `class Config`.
6. **Raise domain exceptions, not raw `HTTPException`.** Define in `domain/exceptions.py`, register handlers in `src/exceptions.py`.
7. **Never `print()`.** Use Python `logging` with structured fields.
8. **`uv` only.** Do not use `pip install` directly. Add deps with `uv add`.
9. **Type everything.** Pyright strict mode. `# type: ignore` requires an inline comment explaining why.

---

## Frontend

### Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 — strict mode |
| Architecture | Feature-Sliced Design (FSD) |
| Styling | Tailwind CSS v4 |
| UI Primitives | shadcn/ui (Radix-based) |
| State (client) | Zustand — one store per feature slice |
| State (server) | TanStack Query v5 |
| Schema Validation | Zod — mirrors backend Pydantic models |
| SVG Rendering | Custom — `src/shared/lib/svg-renderer/` |
| Package Manager | pnpm |

### Feature-Sliced Design Structure

FSD divides the codebase into layers. The import rule is a hard constraint:
**a layer may only import from layers below it.**

```
Layers (top to bottom — upper imports lower, never the reverse):
  app → pages → widgets → features → entities → shared
```

```
frontend/
├── src/
│   │
│   ├── app/                              # Next.js App Router — routing shell only
│   │   ├── layout.tsx                    # Root layout: fonts, providers, global styles
│   │   ├── page.tsx                      # "/" renders <HomePage />
│   │   ├── generate/
│   │   │   └── page.tsx                  # "/generate" renders <GeneratePage />
│   │   ├── plan/
│   │   │   └── [id]/
│   │   │       └── page.tsx              # "/plan/:id" renders <PlanDetailPage />
│   │   └── providers.tsx                 # QueryClientProvider, Zustand hydration
│   │
│   ├── pages/                            # FSD layer: page-level compositions only
│   │   ├── home/
│   │   │   ├── index.ts                  # Public barrel export
│   │   │   └── ui/
│   │   │       └── HomePage.tsx          # Composes: <PromptInputWidget />
│   │   ├── generate/
│   │   │   ├── index.ts
│   │   │   └── ui/
│   │   │       └── GeneratePage.tsx      # Composes: <GeneratingWidget /> or <PlanGridWidget />
│   │   └── plan-detail/
│   │       ├── index.ts
│   │       └── ui/
│   │           └── PlanDetailPage.tsx    # Composes: <PlanViewerWidget />
│   │
│   ├── widgets/                          # FSD layer: self-contained UI blocks
│   │   ├── prompt-input/
│   │   │   ├── index.ts
│   │   │   └── ui/
│   │   │       └── PromptInputWidget.tsx # Textarea + submit, triggers generation feature
│   │   ├── plan-grid/
│   │   │   ├── index.ts
│   │   │   └── ui/
│   │   │       └── PlanGridWidget.tsx    # 2×2 grid of PlanCards, handles selection state
│   │   ├── plan-viewer/
│   │   │   ├── index.ts
│   │   │   └── ui/
│   │   │       └── PlanViewerWidget.tsx  # Large SVG view of selected plan + metadata
│   │   └── generating/
│   │       ├── index.ts
│   │       └── ui/
│   │           └── GeneratingWidget.tsx  # Loading skeleton + streaming progress copy
│   │
│   ├── features/                         # FSD layer: user-facing interactions with side effects
│   │   ├── generate-floor-plan/          # Core Phase A feature
│   │   │   ├── index.ts
│   │   │   ├── api/
│   │   │   │   └── generateFloorPlan.ts  # TanStack Query mutation → POST /floor-plan/generate
│   │   │   ├── model/
│   │   │   │   └── useGenerationStore.ts # Zustand: prompt, schemas, status, generationId
│   │   │   └── ui/
│   │   │       └── GenerateButton.tsx    # Submit button with loading state
│   │   └── select-floor-plan/            # Selecting one schema to carry into Phase B
│   │       ├── index.ts
│   │       ├── model/
│   │       │   └── useSelectionStore.ts  # Zustand: selectedId, selectedSchema
│   │       └── ui/
│   │           └── PlanCard.tsx          # One selectable floor plan card with SVG thumbnail
│   │
│   ├── entities/                         # FSD layer: domain objects and their UI representation
│   │   └── floor-plan/
│   │       ├── index.ts
│   │       ├── model/
│   │       │   └── types.ts              # TypeScript types mirroring backend Pydantic schemas
│   │       └── ui/
│   │           └── FloorPlanSVG.tsx      # Renders a FloorPlanSchema → interactive SVG element
│   │
│   └── shared/                           # FSD layer: zero domain knowledge, purely reusable
│       ├── api/
│       │   └── client.ts                 # Axios base client: baseURL, error interceptor
│       ├── lib/
│       │   ├── svg-renderer/
│       │   │   ├── layout.ts             # Grid units → SVG pixel coordinates
│       │   │   └── builder.ts            # FloorPlanSchema → SVG JSX tree
│       │   └── zod/
│       │       └── floorPlanSchema.ts    # Zod schemas — parse & validate all API responses
│       ├── ui/                           # shadcn/ui re-exports + custom design system tokens
│       │   ├── button.tsx
│       │   ├── textarea.tsx
│       │   ├── skeleton.tsx
│       │   └── badge.tsx
│       └── config/
│           └── env.ts                    # NEXT_PUBLIC_ env vars with type safety
│
├── public/
├── next.config.ts
├── tailwind.config.ts
├── components.json                       # shadcn/ui config
├── tsconfig.json
└── package.json
```

### Key File Contracts

#### `src/entities/floor-plan/model/types.ts`

Mirror backend Pydantic schemas exactly. If the backend schema changes, update this file first.

```typescript
export type RoomType =
  | 'living_room' | 'kitchen' | 'bedroom' | 'bathroom'
  | 'office' | 'dining_room' | 'hallway' | 'balcony' | 'storage';

export type NaturalLight = 'high' | 'medium' | 'low';

export interface Room {
  id: string;
  type: RoomType;
  label: string;
  area_sqm: number;
  width_units: number;
  height_units: number;
  position: { x: number; y: number };
  connections: string[];
  features: string[];
  natural_light: NaturalLight;
}

export interface FloorPlanSchema {
  id: string;
  variant_label: string;
  total_area_sqm: number;
  grid_cols: number;
  grid_rows: number;
  rooms: Room[];
  style_notes: string;
  aesthetic_tags: string[];   // Phase B Style DNA seed — always persist this on selection
}

export interface GenerateFloorPlanResponse {
  schemas: FloorPlanSchema[];
  prompt_interpretation: string;
  generation_id: string;
}
```

#### `src/features/generate-floor-plan/api/generateFloorPlan.ts`
```typescript
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { generateFloorPlanResponseSchema } from '@/shared/lib/zod/floorPlanSchema';
import type { GenerateFloorPlanResponse } from '@/entities/floor-plan/model/types';

interface GeneratePayload {
  prompt: string;
}

const generateFloorPlan = async (payload: GeneratePayload): Promise<GenerateFloorPlanResponse> => {
  const { data } = await apiClient.post('/floor-plan/generate', payload);
  return generateFloorPlanResponseSchema.parse(data); // Zod validates before touching UI
};

export const useGenerateFloorPlan = () =>
  useMutation({ mutationFn: generateFloorPlan });
```

#### `src/features/generate-floor-plan/model/useGenerationStore.ts`
```typescript
import { create } from 'zustand';
import type { FloorPlanSchema } from '@/entities/floor-plan/model/types';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface GenerationStore {
  prompt: string;
  status: Status;
  schemas: FloorPlanSchema[];
  promptInterpretation: string;
  generationId: string | null;

  setPrompt: (prompt: string) => void;
  setLoading: () => void;
  setSuccess: (schemas: FloorPlanSchema[], interpretation: string, genId: string) => void;
  setError: () => void;
  reset: () => void;
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  prompt: '',
  status: 'idle',
  schemas: [],
  promptInterpretation: '',
  generationId: null,

  setPrompt: (prompt) => set({ prompt }),
  setLoading: () => set({ status: 'loading' }),
  setSuccess: (schemas, interpretation, genId) =>
    set({ status: 'success', schemas, promptInterpretation: interpretation, generationId: genId }),
  setError: () => set({ status: 'error' }),
  reset: () => set({ prompt: '', status: 'idle', schemas: [], generationId: null }),
}));
```

#### `src/shared/lib/svg-renderer/layout.ts`
```typescript
import type { Room } from '@/entities/floor-plan/model/types';

// CELL_SIZE is the single source of visual scale for all floor plan SVGs.
// Change this number to make plans larger or smaller — nothing else needs updating.
export const CELL_SIZE = 60; // px per grid unit
export const PADDING   = 24; // px outer padding inside SVG canvas

export const gridToPx = (units: number): number => units * CELL_SIZE;

export const roomToSvgRect = (room: Room) => ({
  x:      PADDING + room.position.x * CELL_SIZE,
  y:      PADDING + room.position.y * CELL_SIZE,
  width:  room.width_units  * CELL_SIZE,
  height: room.height_units * CELL_SIZE,
});

export const planToSvgViewBox = (gridCols: number, gridRows: number): string => {
  const w = PADDING * 2 + gridCols * CELL_SIZE;
  const h = PADDING * 2 + gridRows * CELL_SIZE;
  return `0 0 ${w} ${h}`;
};
```

### FSD Import Rules — Hard Constraints

```
ALLOWED:
  features  →  entities, shared
  widgets   →  features, entities, shared
  pages     →  widgets, features, entities, shared
  app       →  pages, shared

FORBIDDEN:
  entities  →  features        (entities never know about features)
  shared    →  anything above  (shared has zero domain knowledge)
  features  →  other features  (cross-feature: use Zustand or URL params)
  widgets   →  other widgets   (cross-widget: extract to a feature or entity)
```

If you find yourself needing to break these rules, the code belongs in a different layer.

### Frontend Rules

1. **No logic in `app/` or `pages/` layer.** These layers compose widgets only. Zero state, zero API calls, zero hooks other than routing.
2. **One Zustand store per feature.** Never merge two features' state into one store.
3. **TanStack Query for all server state.** Never fetch in `useEffect`. Never store server responses in Zustand — that's Query's job.
4. **Zod validates all API responses** at the API layer before data reaches the UI. `schema.parse(data)` in every API function.
5. **shadcn/ui components are installed via CLI, not hand-written.** Run `pnpx shadcn@latest add <component>`. Never edit files in `src/shared/ui/` manually — re-run the CLI if the design changes.
6. **No `any`.** TypeScript strict mode is on. `as unknown as X` requires an inline comment.
7. **Tailwind only for styling.** No inline `style={{}}` except dynamic SVG geometry (x, y, width, height values).
8. **`pnpm` only.** Do not use `npm` or `yarn`.

---

## Environment Variables

```bash
# .env — root of monorepo, shared by docker-compose
# Never commit this file. Commit .env.example instead.

# Backend — read by pydantic-settings
GOOGLE_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
ENVIRONMENT=local

# Frontend — injected by Next.js at build time
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

---

## API Contract

### `POST /api/v1/floor-plan/generate`

**Request**
```json
{
  "prompt": "3-bedroom modern apartment, open kitchen, home office, natural light"
}
```

**Response 200**
```json
{
  "generation_id": "550e8400-e29b-41d4-a716-446655440000",
  "prompt_interpretation": "A 3-bedroom apartment with an open-plan kitchen-living area, a dedicated home office, and emphasis on natural light through south-facing windows.",
  "schemas": [
    {
      "id": "uuid",
      "variant_label": "Open Flow",
      "total_area_sqm": 88,
      "grid_cols": 6,
      "grid_rows": 5,
      "style_notes": "Maximises visual continuity between kitchen and living areas via a shared open zone.",
      "aesthetic_tags": ["open plan", "minimalist", "natural light"],
      "rooms": [
        {
          "id": "uuid",
          "type": "living_room",
          "label": "Living Room",
          "area_sqm": 28,
          "width_units": 4,
          "height_units": 3,
          "position": { "x": 0, "y": 0 },
          "connections": ["uuid-of-kitchen"],
          "features": ["window_south", "open_to_next"],
          "natural_light": "high"
        }
      ]
    }
  ]
}
```

**Error Responses**

| Status | Trigger |
|---|---|
| `422` | Prompt fails validation (too short, too long, injection detected) |
| `503` | Gemini API timeout or 3-attempt exhaustion |

---

## Local Dev

```bash
# 1. Clone and configure
cp .env.example .env
# Add your GOOGLE_API_KEY to .env

# 2. Start everything
docker-compose up

# Backend only (no Docker)
cd backend && uv sync
uv run uvicorn src.main:app --reload --port 8000

# Frontend only (no Docker)
cd frontend && pnpm install && pnpm dev
```

Backend interactive docs (local only): `http://localhost:8000/docs`

---

## Phase B & C — Stubs Only

Do not implement. Do not scaffold files. Listed here so the Phase A architecture anticipates them.

### Phase B — Spatial Synthesis (Schema → 360° Panoramas)
- New backend domain: `backend/src/panorama/`
- New LangGraph graph: `src/ai/panorama_graph.py`
- Model: Stable Diffusion XL via Replicate + ControlNet conditioning
- Style DNA input: `aesthetic_tags[]` from the selected `FloorPlanSchema` — persist this on selection
- New FSD feature: `frontend/src/features/panorama-viewer/`
- New FSD widget: `frontend/src/widgets/panorama-grid/`

### Phase C — Interactive Design Copilot
- New backend domain: `backend/src/copilot/`
- Transport: WebSocket for real-time chat
- Models: SAM for object segmentation, SDXL inpaint for edits
- New FSD feature: `frontend/src/features/design-copilot/`
- New FSD widget: `frontend/src/widgets/chat-editor/`

---

*Last updated: Phase A initial architecture. Update this file before starting Phase B.*