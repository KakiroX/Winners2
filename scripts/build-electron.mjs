// Bundles the Electron main + preload processes with esbuild.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  external: ['electron'],
  logLevel: 'info',
};

const builds = [
  { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' },
  { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' },
  { ...common, entryPoints: ['electron/mcp-server.ts'], outfile: 'dist-electron/mcp-server.js' },
];

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context(b);
    await ctx.rebuild();
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
