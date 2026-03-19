'use client';

import { useRouter } from 'next/navigation';
import { useGenerateFloorPlan, useGenerationStore, GenerateButton } from '@/features/generate-floor-plan';

export function PromptInputWidget() {
  const router = useRouter();
  const { prompt, setPrompt, setLoading, setSuccess, setError } = useGenerationStore();
  const { mutate, isPending } = useGenerateFloorPlan();

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    setLoading();
    mutate(
      { prompt },
      {
        onSuccess: (data) => {
          setSuccess(data.schemas, data.prompt_interpretation, data.generation_id);
          router.push('/generate');
        },
        onError: () => setError(),
      },
    );
  };

  return (
    <div className="w-full max-w-2xl space-y-3">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe your ideal living space… e.g. 3-bedroom apartment, open kitchen, home office, lots of natural light"
        rows={4}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      <div className="flex justify-end">
        <GenerateButton
          loading={isPending}
          disabled={prompt.trim().length < 10}
          onClick={handleGenerate}
        />
      </div>
    </div>
  );
}
