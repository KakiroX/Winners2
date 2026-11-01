// Marching squares contour extraction producing polylines for a given level.
export function contourLines(X: number[][], Y: number[][], Z: number[][], level: number): [number, number][][] {
  const rows = Z.length, cols = Z[0]?.length ?? 0;
  const segs: [[number, number], [number, number]][] = [];
  const interp = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): [number, number] => {
    const t = z2 === z1 ? 0.5 : (level - z1) / (z2 - z1);
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const z = [Z[i][j], Z[i][j + 1], Z[i + 1][j + 1], Z[i + 1][j]];
      if (z.some((v) => !Number.isFinite(v))) continue;
      const x = [X[i][j], X[i][j + 1], X[i + 1][j + 1], X[i + 1][j]];
      const y = [Y[i][j], Y[i][j + 1], Y[i + 1][j + 1], Y[i + 1][j]];
      let idx = 0;
      z.forEach((v, k) => {
        if (v >= level) idx |= 1 << k;
      });
      if (idx === 0 || idx === 15) continue;
      const e = (a: number, b: number) => interp(x[a], y[a], z[a], x[b], y[b], z[b]);
      const edges: Record<number, [number, number][]> = {
        1: [[3, 0], [0, 1]], 2: [[0, 1], [1, 2]], 3: [[3, 0], [1, 2]], 4: [[1, 2], [2, 3]], 6: [[0, 1], [2, 3]], 7: [[3, 0], [2, 3]],
        8: [[2, 3], [3, 0]], 9: [[2, 3], [0, 1]], 11: [[2, 3], [1, 2]], 12: [[1, 2], [3, 0]], 13: [[1, 2], [0, 1]], 14: [[0, 1], [3, 0]],
      };
      if (idx === 5 || idx === 10) {
        const center = (z[0] + z[1] + z[2] + z[3]) / 4;
        const pairs: [number, number][][] = (idx === 5) === center >= level ? [[[3, 0], [0, 1]], [[1, 2], [2, 3]]] : [[[3, 0], [2, 3]], [[0, 1], [1, 2]]];
        for (const [p, q] of pairs) segs.push([e(p[0], p[1]), e(q[0], q[1])]);
        continue;
      }
      const ed = edges[idx];
      if (ed) segs.push([e(ed[0][0], ed[0][1]), e(ed[1][0], ed[1][1])]);
    }
  }
  // Join segments into polylines
  const key = (p: [number, number]) => `${p[0].toFixed(9)},${p[1].toFixed(9)}`;
  const used = new Array(segs.length).fill(false);
  const byPoint = new Map<string, number[]>();
  segs.forEach((s, k) => {
    for (const p of s) {
      const kk = key(p);
      if (!byPoint.has(kk)) byPoint.set(kk, []);
      byPoint.get(kk)!.push(k);
    }
  });
  const lines: [number, number][][] = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = true;
    const line: [number, number][] = [segs[k][0], segs[k][1]];
    for (const dir of [1, -1]) {
      while (true) {
        const end = dir === 1 ? line[line.length - 1] : line[0];
        const cand = (byPoint.get(key(end)) ?? []).find((s) => !used[s]);
        if (cand === undefined) break;
        used[cand] = true;
        const [a, b] = segs[cand];
        const next = key(a) === key(end) ? b : a;
        if (dir === 1) line.push(next);
        else line.unshift(next);
      }
    }
    lines.push(line);
  }
  return lines;
}
