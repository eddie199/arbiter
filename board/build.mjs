// Builds the local board into templates/board: board.js, board.css and index.html.
//
//   node board/build.mjs      type-check the board, then build it (the CLI's `npm run build` runs this)
//
// The board's build tools install apart from the CLI's (`npm install --prefix board`), so working on the
// CLI alone doesn't need them. Without them this says so and leaves templates/board as it is: the built
// files are committed, like the fonts.
//
// React, Base UI and the board's own components are bundled into one old-style script, not a module,
// so an exported copy still runs when its index.html is opened straight from disk. The CSS is the
// board's globals.css through Tailwind. Nothing is loaded from the network.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'templates', 'board');

if (!fs.existsSync(path.join(here, 'node_modules', 'esbuild'))) {
  console.log('board: not rebuilt, its build tools aren\'t installed (npm install --prefix board). templates/board is unchanged.');
  process.exit(0);
}

// The page and the CLI share the data's shape (src/board-types.ts): a change one side doesn't follow stops here.
const tsc = path.resolve(here, '..', 'node_modules', 'typescript', 'bin', 'tsc');
const checked = spawnSync(process.execPath, [tsc, '--noEmit', '-p', here], { stdio: 'inherit' });
if (checked.status !== 0) {
  console.error('board: type check failed, templates/board is unchanged.');
  process.exit(1);
}

const { build } = await import('esbuild');
const { default: postcss } = await import('postcss');
const { default: tailwind } = await import('@tailwindcss/postcss');

fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(here, 'main.tsx')],
  outfile: path.join(out, 'board.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  tsconfig: path.join(here, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});

const styles = path.join(here, 'styles.css');
const css = await postcss([tailwind({ base: here, optimize: { minify: true } })]).process(fs.readFileSync(styles, 'utf8'), { from: styles });
fs.writeFileSync(path.join(out, 'board.css'), css.css);
fs.copyFileSync(path.join(here, 'index.html'), path.join(out, 'index.html'));

const size = (f) => `${Math.round(fs.statSync(path.join(out, f)).size / 1024)} KB`;
console.log(`board: board.js ${size('board.js')}, board.css ${size('board.css')} → templates/board`);
