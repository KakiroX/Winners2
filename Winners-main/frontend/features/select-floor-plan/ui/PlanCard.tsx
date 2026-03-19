'use client';

import type { FloorPlanSchema } from '@/entities/floor-plan/model/types';
import { FloorPlanSVG } from '@/entities/floor-plan/ui/FloorPlanSVG';

interface Props {
  plan: FloorPlanSchema;
  selected: boolean;
  onSelect: (plan: FloorPlanSchema) => void;
}

export function PlanCard({ plan, selected, onSelect }: Props) {
  return (
    <button
      onClick={() => onSelect(plan)}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
        selected ? 'border-slate-900 shadow-md' : 'border-slate-200 hover:border-slate-400'
      }`}
    >
      <FloorPlanSVG plan={plan} className="w-full aspect-[4/3] mb-3" />
      <p className="font-semibold text-sm text-slate-900">{plan.variant_label}</p>
      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{plan.style_notes}</p>
      <div className="flex flex-wrap gap-1 mt-2">
        {plan.aesthetic_tags.map((tag) => (
          <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {tag}
          </span>
        ))}
      </div>
    </button>
  );
}
