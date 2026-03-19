import { PromptInputWidget } from '@/widgets/prompt-input';

export function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 gap-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">Inhabit</h1>
        <p className="text-slate-500 text-sm">Describe your space. Get a floor plan in seconds.</p>
      </div>
      <PromptInputWidget />
    </main>
  );
}
