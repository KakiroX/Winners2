import type { Project } from '../model/types';
import { defaultGraphOptions, newProject } from '../model/table';

export const PROJECT_EXT = 'quanta';

export function serializeProject(p: Project): string {
  return JSON.stringify({ ...p, modified: new Date().toISOString() }, null, 1);
}

export function deserializeProject(text: string): Project {
  const raw = JSON.parse(text);
  if (raw?.format !== 'quanta-project') throw new Error('This is not a Quanta Studio project file.');
  const base = newProject(raw.name ?? 'Project');
  const p: Project = { ...base, ...raw };
  // Upgrade older files: fill in any new graph option defaults
  p.graphs = (p.graphs ?? []).map((g) => ({ ...g, options: { ...defaultGraphOptions(), ...g.options, xAxis: { ...defaultGraphOptions().xAxis, ...g.options?.xAxis }, yAxis: { ...defaultGraphOptions().yAxis, ...g.options?.yAxis } }, annotations: g.annotations ?? [], fitAnalysisIds: g.fitAnalysisIds ?? [] }));
  p.tables = (p.tables ?? []).map((t) => ({ ...t, excluded: t.excluded ?? [], rowTitles: t.rowTitles ?? [], x: t.x ?? [], notes: t.notes ?? '' }));
  for (const k of ['analyses', 'scripts', 'figures', 'infos'] as const) (p as any)[k] = (p as any)[k] ?? [];
  return p;
}
