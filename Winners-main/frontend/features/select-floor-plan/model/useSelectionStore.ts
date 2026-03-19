import { create } from 'zustand';
import type { FloorPlanSchema } from '@/entities/floor-plan/model/types';

interface SelectionStore {
  selectedId: string | null;
  selectedSchema: FloorPlanSchema | null;
  select: (schema: FloorPlanSchema) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedId: null,
  selectedSchema: null,
  select: (schema) => set({ selectedId: schema.id, selectedSchema: schema }),
  clear: () => set({ selectedId: null, selectedSchema: null }),
}));
