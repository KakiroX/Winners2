'use client';

import { useSelectionStore } from '@/features/select-floor-plan';
import { PlanViewerWidget } from '@/widgets/plan-viewer';

export function PlanDetailPage() {
  const { selectedSchema } = useSelectionStore();

  if (!selectedSchema) return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-slate-400 text-sm">No plan selected.</p>
    </main>
  );

  return (
    <main className="min-h-screen flex flex-col items-center py-12 px-4">
      <PlanViewerWidget plan={selectedSchema} />
    </main>
  );
}
