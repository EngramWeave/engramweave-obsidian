import { build } from 'esbuild';
await build({ entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true, format: 'cjs', platform: 'node',
  target: 'es2022', external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@lezer/common', '@lezer/highlight'], logLevel: 'info' });
