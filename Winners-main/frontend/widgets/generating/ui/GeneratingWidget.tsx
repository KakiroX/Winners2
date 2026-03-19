'use client';

export function GeneratingWidget() {
  return (
    <div className="w-full max-w-4xl space-y-4">
      <p className="text-sm text-slate-500 animate-pulse">Generating your floor plans…</p>
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-4 space-y-3 animate-pulse">
            <div className="w-full aspect-[4/3] bg-slate-100 rounded-lg" />
            <div className="h-4 bg-slate-100 rounded w-1/2" />
            <div className="h-3 bg-slate-100 rounded w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
