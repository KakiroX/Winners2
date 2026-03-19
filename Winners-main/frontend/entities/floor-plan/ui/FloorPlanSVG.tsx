'use client';

import type { FloorPlanSchema } from '@/entities/floor-plan/model/types';
import { buildSvgData } from '@/shared/lib/svg-renderer/builder';

interface Props {
  plan: FloorPlanSchema;
  className?: string;
}

export function FloorPlanSVG({ plan, className }: Props) {
  const { viewBox, rooms } = buildSvgData(plan);

  return (
    <svg viewBox={viewBox} className={className} xmlns="http://www.w3.org/2000/svg">
      {rooms.map(({ key, rect, label, fill }) => (
        <g key={key}>
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            fill={fill}
            stroke="#94A3B8"
            strokeWidth={1.5}
            rx={2}
          />
          <text
            x={rect.x + rect.width / 2}
            y={rect.y + rect.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fill="#334155"
          >
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}
