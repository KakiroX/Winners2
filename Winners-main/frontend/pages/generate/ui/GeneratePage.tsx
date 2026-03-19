'use client';

import { useGenerationStore } from '@/features/generate-floor-plan';
import { GeneratingWidget } from '@/widgets/generating';
import { PlanGridWidget } from '@/widgets/plan-grid';

export function GeneratePage() {
  const { status, schemas, promptInterpretation } = useGenerationStore();

  if (status === 'loading') return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <GeneratingWidget />
    </main>
  );

  if (status === 'error') return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <p className="text-red-500 text-sm">Generation failed. Please try again.</p>
    </main>
  );

  if (status === 'success' && schemas.length > 0) return (
    <main className="min-h-screen flex flex-col items-center py-12 px-4 gap-8">
      <h1 className="text-2xl font-bold text-slate-900">Choose a layout</h1>
      <PlanGridWidget schemas={schemas} interpretation={promptInterpretation} />
    </main>
  );

  return null;
}
