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
