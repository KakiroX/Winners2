import { z } from 'zod';

const roomTypeSchema = z.enum([
  'living_room', 'kitchen', 'bedroom', 'bathroom',
  'office', 'dining_room', 'hallway', 'balcony', 'storage',
]);

const roomFeatureSchema = z.enum([
  'window_north', 'window_south', 'window_east', 'window_west',
  'en_suite', 'island', 'walk_in', 'open_to_next',
]);

const naturalLightSchema = z.enum(['high', 'medium', 'low']);

const roomSchema = z.object({
  id: z.string(),
  type: roomTypeSchema,
  label: z.string(),
  area_sqm: z.number().positive(),
  width_units: z.number().int().min(2),
  height_units: z.number().int().min(2),
  position: z.object({ x: z.number().int(), y: z.number().int() }),
  connections: z.array(z.string()),
  features: z.array(roomFeatureSchema).default([]),
  natural_light: naturalLightSchema,
});

const floorPlanSchema = z.object({
  id: z.string(),
  variant_label: z.string(),
  total_area_sqm: z.number().positive(),
  grid_cols: z.number().int().positive(),
  grid_rows: z.number().int().positive(),
  rooms: z.array(roomSchema),
  style_notes: z.string(),
  aesthetic_tags: z.array(z.string()),
});

export const generateFloorPlanResponseSchema = z.object({
  schemas: z.array(floorPlanSchema).min(3).max(4),
  prompt_interpretation: z.string(),
  generation_id: z.string(),
});
