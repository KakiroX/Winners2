from enum import StrEnum

from pydantic import BaseModel, Field


class RoomType(StrEnum):
    LIVING_ROOM = "living_room"
    KITCHEN = "kitchen"
    BEDROOM = "bedroom"
    BATHROOM = "bathroom"
    OFFICE = "office"
    DINING_ROOM = "dining_room"
    HALLWAY = "hallway"
    BALCONY = "balcony"
    STORAGE = "storage"


class RoomFeature(StrEnum):
    WINDOW_NORTH = "window_north"
    WINDOW_SOUTH = "window_south"
    WINDOW_EAST = "window_east"
    WINDOW_WEST = "window_west"
    EN_SUITE = "en_suite"
    ISLAND = "island"
    WALK_IN = "walk_in"
    OPEN_TO_NEXT = "open_to_next"


class RoomSchema(BaseModel):
    id: str
    type: RoomType
    label: str
    area_sqm: float = Field(gt=0)
    width_units: int = Field(ge=2)
    height_units: int = Field(ge=2)
    position: dict[str, int]
    connections: list[str]
    features: list[RoomFeature] = []
    natural_light: str


class FloorPlanSchema(BaseModel):
    id: str
    variant_label: str
    total_area_sqm: float
    grid_cols: int
    grid_rows: int
    rooms: list[RoomSchema]
    style_notes: str
    aesthetic_tags: list[str]


class GenerateFloorPlanRequest(BaseModel):
    prompt: str = Field(min_length=10, max_length=500)


class GenerateFloorPlanResponse(BaseModel):
    schemas: list[FloorPlanSchema]
    prompt_interpretation: str
    generation_id: str
