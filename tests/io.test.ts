import { describe, expect, it } from 'vitest';
import { readPzfx, writePzfx } from '../src/io/pzfx';
import { parseDelimited, tableFromDelimited, tableToCSV } from '../src/io/csv';
import { sampleTable, rowCount } from '../src/model/table';
import { deserializeProject, serializeProject } from '../src/io/project';
import { newProject } from '../src/model/table';
import { runAnalysis, ANALYSES, defaultParams } from '../src/analysis/registry';
import { compileGraph } from '../src/graph/compile';
import { renderFigure } from '../src/graph/render';
import { newGraph, chartsFor } from '../src/model/table';
import type { TableKind } from '../src/model/types';

const KINDS: TableKind[] = ['xy', 'column', 'grouped', 'contingency', 'survival', 'parts', 'multi'];

describe('Prism XML (.pzfx)', () => {
  it('round-trips every table kind', () => {
    const tables = KINDS.map((k) => sampleTable(k, `T ${k}`));
    tables[1].excluded.push(`${tables[1].datasets[0].id}:0:2`);
    const xml = writePzfx(tables, [{ id: 'i1', type: 'info', name: 'Notes', text: 'hello & <world>' }]);
    expect(xml).toContain('<GraphPadPrismFile');
    const back = readPzfx(xml);
    expect(back.tables.length).toBe(KINDS.length);
    back.tables.forEach((t, i) => {
      expect(t.kind).toBe(tables[i].kind);
      expect(t.datasets.map((d) => d.title)).toEqual(tables[i].datasets.map((d) => d.title));
      expect(rowCount(t)).toBe(rowCount(tables[i]));
      expect(t.datasets[0].cols[0].slice(0, 3)).toEqual(tables[i].datasets[0].cols[0].slice(0, 3));
    });
    expect(back.tables[1].excluded.length).toBe(1);
    expect(back.infos[0].text).toContain('hello & <world>');
  });
  it('reads a Prism-style file with summary data and row titles', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GraphPadPrismFile xmlns="http://graphpad.com/prism/Prism.htm" PrismXMLVersion="5.00">
<TableSequence><Ref ID="Table0" Selected="1"/></TableSequence>
<Table ID="Table0" XFormat="none" YFormat="SDN" TableType="TwoWay" EVFormat="AsteriskAfterNumber">
<Title>Grouped summary</Title>
<RowTitlesColumn Width="39"><Subcolumn><d>Day 1</d><d>Day 2</d></Subcolumn></RowTitlesColumn>
<YColumn Width="243" Decimals="1" Subcolumns="3"><Title>WT</Title>
<Subcolumn><d>10</d><d>12</d></Subcolumn><Subcolumn><d>1.5</d><d>2</d></Subcolumn><Subcolumn><d>5</d><d>5</d></Subcolumn></YColumn>
<YColumn Width="243" Decimals="1" Subcolumns="3"><Title>KO</Title>
<Subcolumn><d>14</d><d Excluded="1">20</d></Subcolumn><Subcolumn><d>1.2</d><d>2.2</d></Subcolumn><Subcolumn><d>5</d><d>4</d></Subcolumn></YColumn>
</Table>
</GraphPadPrismFile>`;
    const { tables } = readPzfx(xml);
    const t = tables[0];
    expect(t.kind).toBe('grouped');
    expect(t.yFormat).toBe('meanSDN');
    expect(t.rowTitles).toEqual(['Day 1', 'Day 2']);
    expect(t.datasets[1].cols[0]).toEqual([14, 20]);
    expect(t.excluded.length).toBe(1);
    const a = { id: 'a', type: 'analysis' as const, name: 'x', kind: 'anova2' as const, tableId: t.id, params: defaultParams('anova2') };
    const res = runAnalysis(t, a);
    expect(res.tables.length).toBeGreaterThan(1);
  });
});

describe('CSV', () => {
  it('parses quoted fields and builds tables', () => {
    expect(parseDelimited('a,"b,c",d\n1,2,3')).toEqual([['a', 'b,c', 'd'], ['1', '2', '3']]);
    const t = tableFromDelimited('dose,ctrl,drug\n1,10,12\n2,20,25\n', 'xy', 'imp');
    expect(t.x).toEqual([1, 2]);
    expect(t.datasets.map((d) => d.title)).toEqual(['ctrl', 'drug']);
    const csv = tableToCSV(t);
    expect(csv.split('\n')[1]).toBe('1,10,12');
  });
});

describe('project files & every analysis/graph combination', () => {
  it('serializes projects', () => {
    const p = newProject('Test');
    p.tables.push(sampleTable('column', 'C'));
    const back = deserializeProject(serializeProject(p));
    expect(back.tables[0].datasets.length).toBe(4);
  });
  it('runs every analysis on its sample tables and renders every chart without errors', () => {
    const p = newProject();
    for (const k of KINDS) p.tables.push(sampleTable(k, k));
    const ctx = { project: p, tableFor: (id: string) => p.tables.find((t) => t.id === id) };
    for (const t of p.tables) {
      for (const def of ANALYSES.filter((a) => a.tableKinds.includes(t.kind))) {
        const a = { id: `a_${def.kind}`, type: 'analysis' as const, name: def.name, kind: def.kind, tableId: t.id, params: defaultParams(def.kind) };
        const res = runAnalysis(t, a);
        const failed = res.warnings.find((w) => w.startsWith('Analysis failed'));
        expect(failed, `${def.kind} on ${t.kind}`).toBeUndefined();
        expect(res.tables.length + res.warnings.length, `${def.kind} on ${t.kind}`).toBeGreaterThan(0);
      }
      for (const c of chartsFor(t.kind)) {
        const svg = renderFigure(compileGraph(newGraph(t, 'g', c), ctx));
        expect(svg.startsWith('<svg'), `${c} on ${t.kind}`).toBe(true);
        expect(svg).not.toContain('NaN');
      }
    }
  });
});
