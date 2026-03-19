import type { FloorPlanSchema } from '@/entities/floor-plan/model/types';
import { planToSvgViewBox, roomToSvgRect } from './layout';

export const ROOM_COLORS: Record<string, string> = {
  living_room: '#E8F4F8',
  kitchen: '#FFF3E0',
  bedroom: '#F3E5F5',
  bathroom: '#E8F5E9',
  office: '#FFF8E1',
  dining_room: '#FCE4EC',
  hallway: '#F5F5F5',
  balcony: '#E0F2F1',
  storage: '#EFEBE9',
};

export interface SvgRoomData {
  key: string;
  rect: { x: number; y: number; width: number; height: number };
  label: string;
  fill: string;
}

export const buildSvgData = (plan: FloorPlanSchema): {
  viewBox: string;
  rooms: SvgRoomData[];
} => ({
  viewBox: planToSvgViewBox(plan.grid_cols, plan.grid_rows),
  rooms: plan.rooms.map((room) => ({
    key: room.id,
    rect: roomToSvgRect(room),
    label: room.label,
    fill: ROOM_COLORS[room.type] ?? '#F0F0F0',
  })),
});
