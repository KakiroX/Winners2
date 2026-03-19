export type RoomType =
  | 'living_room' | 'kitchen' | 'bedroom' | 'bathroom'
  | 'office' | 'dining_room' | 'hallway' | 'balcony' | 'storage';

export type RoomFeature =
  | 'window_north' | 'window_south' | 'window_east' | 'window_west'
  | 'en_suite' | 'island' | 'walk_in' | 'open_to_next';

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
  features: RoomFeature[];
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
  aesthetic_tags: string[];
}

export interface GenerateFloorPlanResponse {
  schemas: FloorPlanSchema[];
  prompt_interpretation: string;
  generation_id: string;
}
