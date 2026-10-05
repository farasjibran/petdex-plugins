/* The one check for the atlas math and the pane-state mapping:
   run it with `node plugins/petdex.pets.test.mjs`. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ANIMATION,
  CELL_H,
  CELL_W,
  COLUMNS,
  KEYFRAMES,
  STATES,
  atlasVars,
  cellSize,
  dragStateFor,
  petStateFor,
  paneState,
  rowsForSheet,
  stripFrames,
  stripVars,
} from './petdex.pets/sprite.js';

assert.equal(dragStateFor(true), 'running-right');
assert.equal(dragStateFor(false), 'running-left');
assert.equal(dragStateFor(true, true), 'running-left');
assert.equal(dragStateFor(false, true), 'running-right');

/* canonical sheet is 8 x 192 wide, and the row count is read off its height */
assert.deepEqual(cellSize(1536, 1872), { w: 192, h: 208 });
assert.deepEqual(cellSize(1536, 2288), { w: 192, h: 208 });
assert.equal(rowsForSheet(1536, 1872), 9);
assert.equal(rowsForSheet(1536, 2288), 11);
assert.equal(rowsForSheet(0, 0), 9);

/* The row count has to come from the image, not from `spriteVersionNumber`:
   sampling 70 atlases found 14 that declare v1 while shipping an 11-row sheet.
   The cells below are the two real sheet shapes, and both must resolve to a
   square-ish 192x208 cell no matter what the manifest claimed. */
for (const [w, h, rows] of [[1536, 1872, 9], [1536, 2288, 11], [768, 936, 9], [768, 1144, 11]]) {
  assert.equal(rowsForSheet(w, h), rows, `${w}x${h} should read as ${rows} rows`);
  /* a smaller sheet means smaller cells, but the 192:208 aspect is the invariant */
  const c = cellSize(w, h);
  assert.equal(c.w, w / 8, `${w}x${h}: cell width`);
  assert.equal(c.h, h / rows, `${w}x${h}: cell height`);
  assert.ok(Math.abs(c.w / c.h - CELL_W / CELL_H) < 1e-9, `${w}x${h}: cell aspect drifted`);
}

/* a doubled sheet keeps the aspect ratio and still lands on whole cells */
assert.deepEqual(cellSize(3072, 3744), { w: 384, h: 416 });

/* the whole reason the pet used to sit frozen: `@` and `.` are not legal in a
   CSS identifier, so the browser dropped the @keyframes rule entirely and the
   first frame just stayed put. One shared name now carries every sheet, so
   there is nothing left to get wrong per pet. */
const LEGAL_IDENT = /^[A-Za-z][A-Za-z0-9_-]*$/;
assert.ok(LEGAL_IDENT.test(ANIMATION), `\`${ANIMATION}\` is not a legal CSS identifier`);
assert.match(KEYFRAMES, new RegExp(`@keyframes ${ANIMATION}\\{`));
/* geometry comes from custom properties, so the rule is sheet-agnostic */
assert.match(KEYFRAMES, /background-position:var\(--pdx-end\) var\(--pdx-y\)/);

/* every step a state samples must land exactly on a cell boundary, or the
   sprite smears sideways instead of stepping */
for (const [id, spec] of Object.entries(STATES)) {
  for (const [w, h] of [[1536, 1872], [1536, 2288]]) {
    for (const scale of [1, 0.5, 0.3077]) {
      const v = atlasVars('u', w, h, id, scale);
      const step = Math.abs(v.end) / v.frames;
      for (let i = 0; i < v.frames; i += 1) {
        const off = (i * step) % v.cell.w;
        assert.ok(
          off < 1e-6 || v.cell.w - off < 1e-6,
          `${id} ${w}x${h} @${scale}: step ${i} at ${i * step}px is not on a cell`,
        );
      }
      assert.equal(v.y, -spec.row * v.cell.h, `${id}: wrong row offset`);
      assert.equal(Math.abs(v.end), spec.frames * v.cell.w, `${id}: end offset must be frames * cell`);
    }
  }
}

/* Whole pixels, all the way down. This is the "the animation is sometimes cut
   off" fix: a fractional cell forces the browser to resample the sheet to a
   fractional background-size, and pixelated rendering rounds each texel on its
   own, so the frame edge drifts and a sliver of the next frame shows. Every
   number the browser is handed has to be an integer. */
for (const scale of [1, 0.75, 0.5, 1 / 3, 0.3077, 0.1201, 2.5]) {
  for (const [w, h] of [[1536, 1872], [1536, 2288], [3072, 3744], [768, 936], [768, 1144]]) {
    for (const state of Object.keys(STATES)) {
      const v = atlasVars('u', w, h, state, scale);
      const whole = {
        'cell.w': v.cell.w, 'cell.h': v.cell.h, 'sheet w': v.sheetWidth,
        'sheet h': v.sheetHeight, y: v.y, end: v.end,
      };
      for (const [what, n] of Object.entries(whole)) {
        assert.ok(Number.isInteger(n), `${state} ${w}x${h} @${scale}: ${what} = ${n}`);
      }
      /* and the sheet really is the cell times the grid, so no rounding can
         have crept between the two */
      assert.equal(v.sheetWidth, v.cell.w * COLUMNS);
      assert.equal(v.sheetHeight, v.cell.h * rowsForSheet(w, h));
      assert.equal(v.sheetHeight, v.cell.h * v.rows);
      /* the step has to be a whole cell in whole pixels */
      assert.equal(Math.abs(v.end) / v.frames, v.cell.w);
    }
  }
}

for (const scale of [1, 0.5, 0.3461, 72 / 208, 0.3077]) {
  for (const [w, h] of [[1152, 208], [1536, 208], [2304, 416], [768, 416]]) {
    const v = stripVars('u', w, h, scale);
    for (const [what, n] of Object.entries({
      'cell.w': v.cell.w, 'cell.h': v.cell.h, 'sheet w': v.sheetWidth, 'sheet h': v.sheetHeight, end: v.end,
    })) {
      assert.ok(Number.isInteger(n), `strip ${w}x${h} @${scale}: ${what} = ${n}`);
    }
    assert.equal(v.sheetWidth, v.cell.w * v.frames);
    assert.equal(Math.abs(v.end) / v.frames, v.cell.w);
  }
}

/* idle sits on row 0, so no vertical offset and the end is 6 cells along */
const idle = atlasVars('u', 1536, 1872, 'idle');
assert.equal(Math.abs(idle.y), 0, 'idle must sit on row 0');
assert.equal(idle.end, -1152);
assert.equal(idle.frames, 6);
assert.equal(idle.ms, 1100);

/* waiting is row 6, pinned at 6 x 208 */
assert.equal(atlasVars('u', 1536, 1872, 'waiting').y, -1248);
/* ...and the same 9-row sheet declared as if it were 11 rows must not move it,
   because the row count comes from the pixels */
assert.equal(atlasVars('u', 1536, 2288, 'waiting').y, -1248);

/* an unknown state must not throw and must fall back to idle */
assert.equal(atlasVars('u', 1536, 1872, 'nope').id, 'idle');

/* half-size draw scales the sheet and the offsets together */
const half = atlasVars('u', 1536, 1872, 'idle', 0.5);
assert.deepEqual(half.cell, { w: 96, h: 104 });
assert.equal(half.sheetWidth, 768);
assert.equal(half.sheetHeight, 936);
assert.equal(half.end, -576);

/* a preview.webp is one row cut from the atlas: 1152x208 is 6 frames of
   192x208. The count has to be derivable from the image alone, because the
   card never sees the sheet. */
assert.equal(stripFrames(1152, 208), 6);
assert.equal(stripFrames(1536, 208), 8);
/* a 2x strip keeps the same count as the 1x strip it was scaled from */
assert.equal(stripFrames(2304, 416), 6);
assert.equal(stripFrames(768, 416), 2);
assert.equal(stripFrames(0, 208), 0);
assert.equal(stripFrames(1152, 0), 0);

const strip = stripVars('u', 1152, 208, 0.35);
assert.equal(strip.frames, 6);
assert.equal(Math.abs(strip.y), 0);
assert.deepEqual(strip.cell, { w: 67, h: 73 });
assert.equal(strip.sheetWidth, 402);
assert.equal(strip.end, -6 * strip.cell.w);
/* scaled strips stay on their cells */
assert.equal(Math.abs(strip.end) / strip.frames, strip.cell.w);

/* the same reading the sidebar, the palette and the sidebar rows use */
assert.equal(paneState(undefined), 'idle');
assert.equal(paneState({}), 'idle');
assert.equal(paneState({ running: false }), 'idle');
assert.equal(paneState({ running: true }), 'working');
assert.equal(paneState({ running: true, state: 'blocked' }), 'blocked');

/* only the pane the user is looking at decides the pet's mood */
const approvals = new Set(['p-2']);
assert.equal(petStateFor({}, null, new Set()), 'idle');
assert.equal(petStateFor({}, undefined, new Set()), 'idle');

const three = { 'p-1': { state: 'working' }, 'p-2': { state: 'idle' }, 'p-3': { state: 'idle' } };
assert.equal(petStateFor(three, 'p-1', new Set()), 'running');
assert.equal(petStateFor(three, 'p-2', new Set()), 'idle');

/* blocked in the focused pane means waiting */
assert.equal(petStateFor({ 'p-1': { state: 'blocked' } }, 'p-1', new Set()), 'waiting');

/* the regression that made pi look idle: no manifest rule matched, so `state`
   is absent and only `running` says anything. Reading `state` alone is what
   the sidebar, the palette and the sidebar rows all guard against. */
assert.equal(petStateFor({ 'p-1': { running: true } }, 'p-1', new Set()), 'running');
assert.equal(petStateFor({ 'p-1': { running: false } }, 'p-1', new Set()), 'idle');
assert.equal(
  petStateFor({ 'p-1': { running: true, state: 'blocked' } }, 'p-1', new Set()),
  'waiting',
);

/* an unresolved approval outranks everything, in any pane: it raises Bentomux's
   own always-on-top prompt, so the pet has to agree with it */
assert.equal(petStateFor(three, 'p-1', approvals), 'waiting');
assert.equal(petStateFor(three, null, approvals), 'waiting');
assert.equal(petStateFor(three, 'p-2', new Set()), 'idle');

/* the grid constants the sheet layout is built on */
assert.equal(COLUMNS, 8);
assert.equal(CELL_W, 192);
assert.equal(CELL_H, 208);

/* The one rule that makes this class of bug impossible to ship again.
 *
 * Sprite geometry is handed to CSS as custom properties, so a property that
 * paint() writes but no rule reads fails silently: the sheet then renders at
 * its natural 1536x1872 inside a 66x72 box, which is a 7x zoom of one frame
 * sliding around instead of a walking sprite. No error, no warning — it just
 * looks wrong. So check the wiring, not just the math. */
const here = fileURLToPath(new URL('.', import.meta.url));
const index = readFileSync(`${here}petdex.pets/index.js`, 'utf8');
const chrome = index.slice(index.indexOf('const CHROME'), index.indexOf('/** One <style>'));
const stylesheet = chrome + KEYFRAMES;

const written = [...new Set([...index.matchAll(/setProperty\('(--pdx-[\w-]+)'/g)].map(m => m[1]))];
assert.deepEqual(written.sort(), ['--pdx-end', '--pdx-frames', '--pdx-h', '--pdx-ms', '--pdx-url', '--pdx-w', '--pdx-y']);
for (const name of written) {
  assert.ok(stylesheet.includes(`var(${name})`), `${name} is set by paint() but no rule reads it`);
}
/* and the sheet really is scaled, not left at natural size */
assert.match(chrome, /background-size:var\(--pdx-w\) var\(--pdx-h\)/);
assert.match(chrome, /--pdx-w:auto/);

/* An always-running pet has to yield to the OS accessibility setting. Losing
   this in a refactor is invisible in review and annoying for everyone who set
   it, so it is asserted rather than remembered. */
assert.match(chrome, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(chrome, /@keyframes pdx-spin/);

/* The selected pet has to read as "on" without the user reading the label, so
   it carries a check and a green border in both themes. A green that only has
   one value passes review and disappears into a dark background, so both the
   light and the dark literal are asserted — the pair the app's own diff page
   already uses, because the palette has no --ok token. */
assert.match(chrome, /\.pdx__card\[aria-pressed="true"\][^{]*\{[^}]*border-color:#1a7f37/);
assert.match(chrome, /:root\.dark \.pdx__card\[aria-pressed="true"\][^{]*\{[^}]*border-color:#7ee787/);
assert.match(chrome, /\.pdx__card\[aria-pressed="true"\] \.pdx__check\s*\{\s*display:block/);
assert.match(index, /check\.textContent = '\\u2713'/);

/* The picker lives in Settings now. Settings drops a section's DOM on every
   switch without calling a cleanup, so the build fn has to retire the previous
   one itself — a leaked debounce timer or a stale image probe writing into a
   detached tree is invisible and grows every time the user reopens it. */
assert.match(index, /retirePicker\?\.\(\)/);
assert.match(index, /retirePicker = \(\) => \{/);
assert.doesNotMatch(index, /context\.ui\.tab\(|context\.ui\.openTab\(/);

/* The manifest has to declare what the code registers; the host throws on an
   undeclared slot, which would break activation rather than fail a test. */
const manifest = JSON.parse(readFileSync(`${here}petdex.pets/plugin.json`, 'utf8'));
const declared = new Set(manifest.contributes.settings.map(s => s.id));
assert.ok(declared.has('petdex.pets.picker'), 'the picker section must be declared');
assert.ok(index.includes("settingsSection('petdex.pets.picker'"), 'picker id must match the manifest');
/* the picker is reached from Settings, so nothing may still point at a topbar
   button or a tab that no longer exists */
for (const gone of ['topbar', 'tabs']) {
  assert.ok(!manifest.contributes[gone], `${gone} contribution should be gone`);
}
for (const c of manifest.contributes.commands) {
  assert.ok(index.includes(`command('${c.id}'`), `${c.id} is declared but never registered`);
}
for (const s of manifest.contributes.services) {
  assert.ok(index.includes(`service('${s.id}'`), `${s.id} is declared but never registered`);
}

console.log('sprite.js ok');
