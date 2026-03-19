'use client';

import type { FloorPlanSchema } from '@/entities/floor-plan/model/types';
import { PlanCard, useSelectionStore } from '@/features/select-floor-plan';

interface Props {
  schemas: FloorPlanSchema[];
  interpretation: string;
}

export function PlanGridWidget({ schemas, interpretation }: Props) {
  const { selectedId, select } = useSelectionStore();

  return (
    <div className="w-full max-w-4xl space-y-6">
      <p className="text-sm text-slate-600 italic">{interpretation}</p>
      <div className="grid grid-cols-2 gap-4">
        {schemas.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            selected={selectedId === plan.id}
            onSelect={select}
          />
        ))}
      </div>
    </div>
  );
}
