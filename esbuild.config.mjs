import { build } from 'esbuild';
await build({ entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true, format: 'cjs', platform: 'node',
  target: 'es2022', external: ['obsidian', 'electron'], logLevel: 'info' });
