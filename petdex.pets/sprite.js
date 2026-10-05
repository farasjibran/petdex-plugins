/* Petdex sprite atlas geometry and agent-state mapping.
 *
 * A Petdex spritesheet is a grid of 8 columns; every cell is 192x208 in the
 * canonical sheet. Row 0 is idle, row 1 running-right, and so on — the state
 * table below is the one Petdex itself uses, so a sheet made for the Petdex
 * desktop app plays here unchanged.
 *
 * Sheets may be integer-scaled variants, so cell size is derived from the
 * sheet's own pixel dimensions rather than hardcoded. `spriteVersionNumber`
 * says how many rows the sheet carries: v1 has the 9 state rows, v2 adds two
 * spare rows. Only the row count matters, and only for the cell height.
 *
 * https://github.com/crafter-station/petdex */

export const COLUMNS = 8;
export const CELL_W = 192;
export const CELL_H = 208;

/** One animation name for the whole plugin. */
export const ANIMATION = 'pdx-pet';

/**
 * The single @keyframes rule every sprite in the plugin shares.
 *
 * Geometry lives in custom properties on each element rather than in baked
 * offsets, so one rule covers every sheet, every state and every size — a
 * gallery of 48 cards costs one rule, not 48. This is the same shape as
 * petdex's own `--sprite-row` / `--sprite-end-x`.
 *
 * `--pdx-end` must be `frames * --pdx-cell-w`, not `(frames - 1) * cell`:
 * steps(N) samples the range at 0, 1/N, ..., (N-1)/N, so ending on the last
 * frame lands every sample between cells and the sprite smears sideways
 * instead of stepping.
 */
export const KEYFRAMES = `@keyframes ${ANIMATION}{` +
  'from{background-position:0 var(--pdx-y)}' +
  'to{background-position:var(--pdx-end) var(--pdx-y)}}';

export const STATES = {
  idle: { row: 0, frames: 6, ms: 1100 },
  'running-right': { row: 1, frames: 8, ms: 1060 },
  'running-left': { row: 2, frames: 8, ms: 1060 },
  waving: { row: 3, frames: 4, ms: 700 },
  jumping: { row: 4, frames: 5, ms: 840 },
  failed: { row: 5, frames: 8, ms: 1220 },
  waiting: { row: 6, frames: 6, ms: 1010 },
  running: { row: 7, frames: 6, ms: 820 },
  review: { row: 8, frames: 6, ms: 1030 },
};

/**
 * How many rows a sheet actually carries, read off the sheet's own pixels.
 *
 * The manifest's `spriteVersionNumber` is not trustworthy: sampling 70 atlases
 * found 14 that declare v1 while shipping an 11-row 1536x2288 sheet. Taking the
 * field at its word makes `cellSize` divide 11 rows by 9, so the cell comes out
 * 11% too tall, every row is drawn stretched and shifted, and the higher state
 * rows land on the wrong art — the sprite reads as cropped. It is intermittent
 * by nature, which is why it surfaces as "some pets are broken".
 *
 * A sheet is 8 columns of cells whose aspect the format fixes, so the row
 * count follows from the width and needs no declaration at all. Same trick as
 * `stripFrames`: let the image speak.
 */
export function rowsForSheet(sheetWidth, sheetHeight) {
  if (!sheetWidth || !sheetHeight) return 9;
  return Math.max(1, Math.round(sheetHeight / ((sheetWidth / COLUMNS) * (CELL_H / CELL_W))));
}

/** Cell size in px for a sheet of these dimensions, exactly, before snapping. */
export function cellSize(sheetWidth, sheetHeight, scale = 1) {
  return {
    w: (sheetWidth / COLUMNS) * scale,
    h: (sheetHeight / rowsForSheet(sheetWidth, sheetHeight)) * scale,
  };
}

/**
 * Round a cell to whole pixels.
 *
 * A fractional cell makes the browser resample the sheet to a fractional
 * background-size, and `image-rendering: pixelated` rounds every source texel
 * on its own — so the frame boundary drifts by a texel and a sliver of the
 * *neighbouring* frame shows along one edge. It only bites on some frames and
 * some pets, which is exactly the "the animation is sometimes cut off" report.
 *
 * Snapping the cell means the sheet is then an exact multiple of it
 * (`cell * frames` is whole by construction), the step is a whole number of
 * pixels, and nothing can drift. The cost is at most 0.7% of aspect ratio,
 * which on pixel art is invisible.
 */
function snap(cell) {
  return { w: Math.max(1, Math.round(cell.w)), h: Math.max(1, Math.round(cell.h)) };
}

/**
 * How many frames a `preview.webp` strip holds.
 *
 * A preview is one row cut out of the atlas — idle, 6 frames of 192x208 — so
 * the cell is square-derivable from the strip's own height and the count falls
 * out of the width. No manifest round trip, and a sheet that is not the
 * canonical size still lands on whole cells.
 */
export function stripFrames(stripWidth, stripHeight) {
  if (!stripWidth || !stripHeight) return 0;
  return Math.max(1, Math.round(stripWidth / (stripHeight * (CELL_W / CELL_H))));
}

/**
 * The custom properties that play one row of a sheet, drawn at a scale.
 *
 * `state` picks the row; `y` is that row's offset and `end` is `frames` cells
 * along. Returned as plain values so they can be asserted without a DOM.
 */
export function atlasVars(spriteUrl, sheetWidth, sheetHeight, state, scale = 1) {
  const id = STATES[state] ? state : 'idle';
  const spec = STATES[id];
  const rows = rowsForSheet(sheetWidth, sheetHeight);
  const cell = snap(cellSize(sheetWidth, sheetHeight, scale));
  return {
    id,
    cell,
    rows,
    frames: spec.frames,
    ms: spec.ms,
    url: spriteUrl,
    /* whole by construction: the sheet is exactly `cell` times the grid */
    sheetWidth: cell.w * COLUMNS,
    sheetHeight: cell.h * rows,
    y: -spec.row * cell.h,
    end: -spec.frames * cell.w,
  };
}

/** The same, for a single-row preview strip. */
export function dragStateFor(rightward, reversed = false) {
  const facingRight = rightward !== reversed;
  return facingRight ? 'running-right' : 'running-left';
}

export function stripVars(stripUrl, stripWidth, stripHeight, scale = 1, state = 'idle') {
  const spec = STATES[state] || STATES.idle;
  const cell = snap({ w: stripHeight * (CELL_W / CELL_H) * scale, h: stripHeight * scale });
  const frames = stripFrames(stripWidth, stripHeight);
  return {
    id: state,
    cell,
    frames,
    ms: spec.ms,
    url: stripUrl,
    sheetWidth: cell.w * frames,
    sheetHeight: cell.h,
    y: 0,
    end: -frames * cell.w,
  };
}

/**
 * One pane's state, the same way the sidebar and the palette read it.
 *
 * `state` is null whenever no manifest rule matched the pane's screen, which
 * is the normal case mid-run for an agent whose output has not hit a known
 * pattern. `running` — a process is attached and it has emitted recently — is
 * the fallback the app uses everywhere else; reading `state` alone makes a
 * busy pane look idle.
 */
export function paneState(status) {
  return status?.state ?? (status?.running ? 'working' : 'idle');
}

/**
 * Bentomux runtime status -> pet state, for one pane.
 *
 * `statuses` is the whole map keyed by pane id and `paneId` is the pane the
 * user is looking at. Only that pane counts: a background tab churning through
 * a build should not make the pet in front of you look busy.
 *
 * `approvalPanes` is the set of panes holding an unresolved approval request.
 * Unlike run state, that is deliberately *not* scoped to the focused pane: an
 * approval raises Bentomux's own always-on-top prompt regardless of which tab
 * you are on, so the pet has to agree with it. Attention outranks work.
 */
export function petStateFor(statuses, paneId, approvalPanes) {
  if (approvalPanes?.size) return 'waiting';
  if (!paneId) return 'idle';
  const state = paneState(statuses?.[paneId]);
  if (state === 'blocked') return 'waiting';
  if (state === 'running' || state === 'working') return 'running';
  return 'idle';
}
