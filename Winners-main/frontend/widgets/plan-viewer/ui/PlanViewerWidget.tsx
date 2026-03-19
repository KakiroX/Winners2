'use client';

import type { FloorPlanSchema } from '@/entities/floor-plan/model/types';
import { FloorPlanSVG } from '@/entities/floor-plan/ui/FloorPlanSVG';

interface Props {
  plan: FloorPlanSchema;
}

export function PlanViewerWidget({ plan }: Props) {
  return (
    <div className="w-full max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{plan.variant_label}</h2>
        <p className="text-sm text-slate-500 mt-1">{plan.style_notes}</p>
      </div>
      <FloorPlanSVG plan={plan} className="w-full border border-slate-200 rounded-xl" />
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide">Total area</p>
          <p className="font-medium text-slate-800">{plan.total_area_sqm} m²</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide">Grid</p>
          <p className="font-medium text-slate-800">{plan.grid_cols} × {plan.grid_rows}</p>
        </div>
      </div>
      <div>
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Style DNA</p>
        <div className="flex flex-wrap gap-2">
          {plan.aesthetic_tags.map((tag) => (
            <span key={tag} className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-slate-400 text-xs uppercase tracking-wide">Rooms</p>
        {plan.rooms.map((room) => (
          <div key={room.id} className="flex justify-between text-sm border-b border-slate-100 pb-1">
            <span className="text-slate-700">{room.label}</span>
            <span className="text-slate-400">{room.area_sqm} m²</span>
          </div>
        ))}
      </div>
    </div>
  );
}
