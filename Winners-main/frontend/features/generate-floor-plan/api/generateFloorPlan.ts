import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { generateFloorPlanResponseSchema } from '@/shared/lib/zod/floorPlanSchema';
import type { GenerateFloorPlanResponse } from '@/entities/floor-plan/model/types';

interface GeneratePayload {
  prompt: string;
}

const generateFloorPlan = async (payload: GeneratePayload): Promise<GenerateFloorPlanResponse> => {
  const { data } = await apiClient.post('/floor-plan/generate', payload);
  return generateFloorPlanResponseSchema.parse(data) as GenerateFloorPlanResponse;
};

export const useGenerateFloorPlan = () =>
  useMutation({ mutationFn: generateFloorPlan });
