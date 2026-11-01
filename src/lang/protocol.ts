import type { DataTable } from '../model/types';
import type { FigureSpec } from '../graph/spec';

export interface VarInfo {
  name: string;
  size: string;
  cls: string;
  preview: string;
  bytes: number;
}

export type Effect =
  | { type: 'putTable'; table: DataTable }
  | { type: 'writeFile'; path: string; data: Uint8Array | string }
  | { type: 'createGraph'; tableName: string; chart: string }
  | { type: 'createAnalysis'; tableName: string; kind: string; params: Record<string, any> }
  | { type: 'saveFigure'; number: number; path: string; format: string };

export interface FigureSnapshot {
  number: number;
  name: string;
  spec: FigureSpec;
}

export type ToWorker =
  | { type: 'exec'; id: number; code: string; tables: DataTable[]; files: Record<string, Uint8Array>; sandbox: boolean; timeoutMs: number; library: { name: string; code: string }[]; echo?: boolean; unitName?: string }
  | { type: 'getVar'; id: number; name: string }
  | { type: 'loadMat'; id: number; data: Uint8Array }
  | { type: 'saveMat'; id: number; names: string[] }
  | { type: 'setVar'; id: number; name: string; rows: number; cols: number; data: number[] }
  | { type: 'clear'; id: number }
  | { type: 'names'; id: number };

export type FromWorker =
  | { type: 'out'; id: number; text: string }
  | { type: 'done'; id: number; ok: boolean; error?: string; workspace: VarInfo[]; figures?: FigureSnapshot[]; effects: Effect[] }
  | { type: 'var'; id: number; value: SerializedVar | null }
  | { type: 'bytes'; id: number; data: Uint8Array | null; error?: string }
  | { type: 'names'; id: number; names: string[] };

export interface SerializedVar {
  name: string;
  kind: string;
  cls: string;
  rows: number;
  cols: number;
  re?: number[];
  im?: number[];
  text: string;
}
