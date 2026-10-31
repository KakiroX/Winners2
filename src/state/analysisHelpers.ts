import { ANALYSES, type AnalysisDef } from '../analysis/registry';
import type { TableKind } from '../model/types';

export function analysisKindsFor(kind: TableKind): AnalysisDef[] {
  return ANALYSES.filter((a) => a.tableKinds.includes(kind));
}

export function groupedAnalyses(kind: TableKind): [string, AnalysisDef[]][] {
  const groups = new Map<string, AnalysisDef[]>();
  for (const a of analysisKindsFor(kind)) {
    if (!groups.has(a.category)) groups.set(a.category, []);
    groups.get(a.category)!.push(a);
  }
  return [...groups.entries()];
}
