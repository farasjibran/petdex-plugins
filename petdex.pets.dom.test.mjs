/* Gallery behaviour, driven through the real plugin entry against a fake DOM.
 *
 *   node plugins/petdex.pets.dom.test.mjs
 *
 * The gallery is the part of this plugin with real branching in it: paging,
 * debouncing, a roving tab stop, an image fallback. sprite.js is pure maths and
 * gets a plain assert file; this gets a DOM because none of that is observable
 * without one. The fake is ~150 lines of Element and it is deliberately not a
 * general-purpose shim — it implements the handful of selectors and layout
 * facts this plugin actually uses, and nothing else.
 *
 * It has already earned its keep: it caught the roving tab stop being dropped
 * on the first arrow press, which is invisible until you press Tab and get
 * dumped out of the gallery. */

import { fileURLToPath } from 'node:url';
import { atlasVars, cellSize, stripVars } from './petdex.pets/sprite.js';
import { THUMB_HEIGHT } from './petdex.pets/index.js';

const COLS = 5;            // pretend the grid is 5 columns wide
const imgQueue = [];       // pending Image() loads, drained by flushImages()
const intervals = [];
const timeouts = [];
const timeoutDurations = [];
const PET_COUNT = 130;     // so the pager has to be clicked twice

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.className = '';
    this.tabIndex = 0;
    this.style = { props: new Map(), setProperty(k, v) { this.props.set(k, v); } };
    this._text = null;
    this.listeners = new Map();
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.focused = false;
  }
  get classList() {
    const self = this;
    return { toggle(c, on) { const s = new Set(self.classes()); on ??= !s.has(c); on ? s.add(c) : s.delete(c); self.className = [...s].join(' '); } };
  }
  classes() { return this.className.split(/\s+/).filter(Boolean); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  get textContent() {
    return this.children.length ? this.children.map(c => c.textContent).join('') : (this._text ?? '');
  }
  set textContent(v) { this._text = v; this.children = []; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] ?? null; }
  append(...kids) {
    for (const k of kids) {
      /* the real DOM splices a fragment's children in; the fake has to as well
         or the grid ends up holding one phantom fragment node */
      if (k instanceof El && k.tagName === '#FRAGMENT') {
        for (const grand of k.children.splice(0)) { grand.parentNode = this; this.children.push(grand); }
        continue;
      }
      if (k instanceof El) { k.parentNode = this; this.children.push(k); }
      else { const t = new El('#text'); t._text = k; t.parentNode = this; this.children.push(t); }
    }
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }
  addEventListener(t, fn) { (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)).push(fn); }
  fire(t, ev = {}) { for (const fn of this.listeners.get(t) ?? []) fn({ preventDefault() {}, ...ev }); }
  focus() { globalThis.__focused = this; this.fire('focus'); }
  scrollIntoView() {}
  get offsetTop() {
    if (this.parentNode?.classes().includes('pdx__grid')) {
      return Math.floor(this.parentNode.children.indexOf(this) / COLS) * 100;
    }
    return 0;
  }
  get offsetLeft() { return parseFloat(this.style.left) || 0; }
  get offsetTop() {
    if (this.parentNode?.classes().includes('pdx__grid')) {
      return Math.floor(this.parentNode.children.indexOf(this) / COLS) * 100;
    }
    return parseFloat(this.style.top) || 0;
  }
  get offsetWidth() { return 100; }
  get offsetHeight() { return 120; }
  getBoundingClientRect() { return { left: this.offsetLeft, top: this.offsetTop }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  matches(sel) {
    for (const part of sel.split(',')) {
      const q = part.trim();
      const not = /(\.[\w-]+):not\(\.([\w-]+)\)/.exec(q);
      if (not) {
        if (this.classes().includes(not[1].slice(1)) && !this.classes().includes(not[2])) return true;
        continue;
      }
      if (q.startsWith('.')) { if (this.classes().includes(q.slice(1))) return true; continue; }
      if (/^[\w-]+$/.test(q)) { if (this.tagName === q.toUpperCase()) return true; continue; }
      if (q === ':scope') return true;
    }
    return false;
  }
  walk(sel, out = []) {
    for (const kid of this.children) {
      if (kid.matches(sel)) out.push(kid);
      kid.walk(sel, out);
    }
    return out;
  }
  /* `A > B` and `:scope > B`, searched across the whole subtree: grid
     `.pdx__thumb > .pdx-spinner` is a grandchild, not a direct child */
  querySelectorAll(sel) {
    if (!sel.includes('>')) return this.walk(sel);
    const [parentSel, kidSel] = sel.split('>').map(s => s.trim());
    const out = [];
    const visit = node => {
      for (const kid of node.children) {
        if (node.matches(parentSel) && kid.matches(kidSel)) out.push(kid);
        visit(kid);
      }
    };
    visit(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

globalThis.Image = class { set src(v) { imgQueue.push({ img: this, url: v }); } };
globalThis.setInterval = fn => { intervals.push(fn); return intervals.length; };
globalThis.clearInterval = () => {}; 
function settle() { let n = 0; while (imgQueue.length && n++ < 6) flushImages(); }
function flushImages() {
  for (const { img, url } of imgQueue.splice(0, imgQueue.length)) {
    const isSheet = url.includes('/sheets/');
    if (url.includes('total-gone')) img.onerror?.();
    else if (url.includes('gone') && !url.includes('/sheets/')) img.onerror?.();
    else if (isSheet) { img.naturalWidth = 1536; img.naturalHeight = 1872; img.onload?.(); }
    else { img.naturalWidth = 1152; img.naturalHeight = 208; img.onload?.(); }
  }
}
globalThis.window = { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  head: new El('head'), body: new El('body'),
  createElement: t => new El(t), createTextNode: t => { const e = new El('#text'); e._text = t; return e; },
  createDocumentFragment: () => new El('#fragment'),
  getElementById: () => null,
};

/* the manifest is fetched at tab-registration time and cached in module scope,
   so the fake has to be in place before the import */
const kindOf = i => ['creature', 'character', 'object'][i % 3];
const manifestResponse = {
  ok: true,
  json: async () => ({
    pets: [
      ...Array.from({ length: PET_COUNT }, (_, i) => [`pet-${i}`, `Pet ${i}`, kindOf(i), `maker-${i % 4}`, `sheets/pet-${i}.webp`, null, null, 1]),
      ['pet-preview-gone', 'Preview Gone', 'creature', 'someone', 'sheets/pet-preview-gone.webp', null, null, 1],
      ['pet-total-gone', 'Total Gone', 'creature', 'someone', 'sheets/pet-total-gone.webp', null, null, 1],
    ],
  }),
};
/* the bundled pets.json, shaped like the real one: positional rows, so a change
   to the column order in refresh.mjs breaks these checks loudly */
const snapshotResponse = {
  ok: true,
  json: async () => ({
    fields: ['slug', 'installs', 'loves', 'description', 'vibes', 'tags', 'approved'],
    pets: [
      ...Array.from({ length: PET_COUNT }, (_, i) => [
        /* pet 0 leads every default view, so it also carries a count big
           enough to prove the abbreviation; the rest count up in pet order */
        `pet-${i}`, i ? (i + 1) * 7 : 12000, i ? (i + 1) * 13 : 26,
        `Specimen ${(c => c + c)(String.fromCharCode(97 + (i % 26)))}`, ['cozy'], [`tag-${i}`], '2026-05-01',
      ]),
      ['pet-preview-gone', 3, 1, '', [], [], '2026-05-02'],
      ['pet-total-gone', 3, 1, '', [], [], '2026-05-03'],
    ],
  }),
};
const pendingManifests = [];
globalThis.fetch = url => new Promise((resolve, reject) => pendingManifests.push({
  url: String(url),
  resolve: () => resolve(String(url).includes('pets.json') ? snapshotResponse : manifestResponse),
  reject: () => reject(new Error('network blocked')),
}));

const { activate } = await import(
  fileURLToPath(new URL('./petdex.pets/index.js', import.meta.url))
);

const sections = new Map();
const saved = new Map();
let runtimeStatusListener = null;
saved.set('pet', 'pet-3');   // so the "active:" branch of the count label is exercised
saved.set('reversed-pets', []);
const ctx = {
  storage: { get: async k => saved.get(k), set: async (k, v) => saved.set(k, v) },
  events: { on: (_event, cb) => { cb({ paneId: 'pane-1' }); return () => {}; } },
  app: {
    onRuntimeStatus: cb => {
      runtimeStatusListener = cb;
      cb({ 'pane-1': { running: true, state: 'working' } });
      return () => {};
    },
    onAgentApproval: () => () => {},
    onAgentApprovalClosed: () => () => {},
  },
  ui: { command() {}, service() {}, settingsSection: (id, fn) => sections.set(id, fn) },
  dispose() {},
  log: (...a) => console.log('   [log]', ...a),
};
activate(ctx);

/* Settings calls the build fn, drops whatever the previous call returned, and
   appends the new tree — so the test host does the same, including the throw. */
const contentHost = new El('div');
const build = sections.get('petdex.pets.picker');
const paint = () => {
  contentHost.textContent = '';
  contentHost.append(build());
};
paint();
let root = contentHost.children[0];
let grid = root.querySelector('.pdx__grid');
let search = root.querySelector('input');
let count = root.querySelector('.pdx__count');
const cards = () => grid.querySelectorAll('.pdx__card:not(.pdx__card--more)');
const moreBtn = () => grid.querySelector('.pdx__card--more');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : `   want ${want}`}`);
};

console.log('\n1. cold open shows a spinner, not an empty grid');
check('loading row', grid.querySelectorAll('.pdx__loading').length, 1);
check('spinner present', !!grid.querySelector('.pdx-spinner'), true);
check('count not claiming a number', count.textContent, '');
search.value = 'Pet 7';
search.fire('input');
await tick(150);
check('search during manifest load keeps loading state', grid.querySelectorAll('.pdx__loading').length, 1);
search.fire('keydown', { key: 'Enter' });
for (const request of pendingManifests.splice(0)) request.reject();
await tick();
check('failed manifest shows recovery message', grid.querySelector('.pdx__loading').textContent,
  'Could not reach petdex.dev — network blocked');
search.value = 'Pet 7';
search.fire('input');
await tick(150);
check('search after manifest failure keeps recovery message', grid.querySelector('.pdx__loading').textContent,
  'Could not reach petdex.dev — network blocked');
paint();
root = contentHost.children[0];
grid = root.querySelector('.pdx__grid');
search = root.querySelector('input');
count = root.querySelector('.pdx__count');

console.log('\n2. thumbnails are busy until their image decodes');
/* the catalogue is two requests — the manifest, then the bundled counts — and
   the second is only queued once the first resolves, so drain in rounds */
for (let round = 0; round < 4 && pendingManifests.length; round++) {
  for (const request of pendingManifests.splice(0)) request.resolve();
  await tick();
}
check('cards', cards().length, 48);
check('busy spinners waiting on images', grid.querySelectorAll('.pdx__thumb > .pdx-spinner').length, 48);
settle();
check('spinners cleared after decode', grid.querySelectorAll('.pdx-spinner').length, 0);
check('thumb painted with scaled strip width', cards()[0].querySelector('.pdx__thumb').style.props.get('--pdx-w'),
  `${stripVars('u', 1152, 208, THUMB_HEIGHT / 208).sheetWidth}px`);
check('one tab stop in the whole grid', cards().filter(c => c.tabIndex === 0).length, 1);

console.log('\n3. "Show more" APPENDS, never rebuilds  (regression #1)');
const before = cards();
const firstBefore = before[0];
const urlBefore = firstBefore.querySelector('.pdx__thumb').style.props.get('--pdx-url');
moreBtn().fire('click');
settle();
check('cards after 1st page', cards().length, 96);
check('existing card is the same DOM node', cards()[0] === firstBefore, true);
check('its painted url untouched', cards()[0].querySelector('.pdx__thumb').style.props.get('--pdx-url') === urlBefore, true);
check('pager stays last', grid.children[grid.children.length - 1] === moreBtn(), true);
check('pager label updated', moreBtn().textContent, 'Show 36 more');

console.log('\n4. second page exhausts the list');
moreBtn().fire('click');
settle();
check('cards total', cards().length, 132);
check('pager removed', moreBtn(), null);
check('count', count.textContent, 'active: Pet 3 — 132 pets');

console.log('\n5. keyboard nav  (regression #3)');
globalThis.__focused = null;
cards()[0].focus();
grid.fire('keydown', { key: 'ArrowRight' });
check('ArrowRight -> card 1', globalThis.__focused === cards()[1], true);
grid.fire('keydown', { key: 'ArrowDown' });
check(`ArrowDown -> card ${1 + COLS} (one row)`, globalThis.__focused === cards()[1 + COLS], true);
grid.fire('keydown', { key: 'ArrowUp' });
check('ArrowUp -> back to card 1', globalThis.__focused === cards()[1], true);
grid.fire('keydown', { key: 'End' });
check('End -> last card', globalThis.__focused === cards()[131], true);
grid.fire('keydown', { key: 'ArrowRight' });
check('ArrowRight clamps at the end', globalThis.__focused === cards()[131], true);
grid.fire('keydown', { key: 'Home' });
check('Home -> first card', globalThis.__focused === cards()[0], true);
grid.fire('keydown', { key: 'Escape' });
check('Escape -> search box', globalThis.__focused === search, true);
check('roving tabindex still single', cards().filter(c => c.tabIndex === 0).length, 1);

console.log('\n6. search is debounced  (regression #2)');
const survivor = cards()[0];
search.value = 'Pet 12';
search.fire('input');
check('no redraw on the keystroke itself', cards()[0] === survivor, true);
await tick(60);
check('still nothing at 60ms', cards()[0] === survivor, true);
await tick(120);
check('redrawed after 120ms', cards().length, 12);      // Pet 12, 112, 120..129
check('old nodes are gone', cards().includes(survivor), false);

console.log('\n7. Enter searches immediately, without waiting out the debounce');
search.value = 'Pet 7';
search.fire('input');
search.fire('keydown', { key: 'Enter' });
check('applied at once', cards().length, 22);           // Pet 7, 17..67, 70..79

console.log('\n8. no matches');
search.value = 'zzzz';
search.fire('input');
await tick(150);
check('empty-state row', grid.querySelectorAll('.pdx__loading').length, 1);
check('says so', grid.querySelector('.pdx__loading').textContent, 'No pets match that search.');
check('no cards left behind', cards().length, 0);

console.log('\n9. a pet with no preview falls back to the sheet; one with neither just stops spinning');
search.value = 'gone';
search.fire('input');
await tick(150);
settle();
const fallback = cards().find(c => c.textContent.includes('Preview Gone'));
const dead = cards().find(c => c.textContent.includes('Total Gone'));
check('both cards', cards().length, 2);
const painted = parseFloat(fallback.querySelector('.pdx__thumb').style.props.get('--pdx-w'));
/* it has to be the 8-column sheet, not the 6-frame strip the preview would have
   been — and the expectation comes from the sheet maths, not a literal, so the
   check survives a geometry fix */
check('fallback cropped the 1536-wide sheet, not the 1152-wide strip',
  painted === atlasVars('u', 1536, 1872, 'idle', THUMB_HEIGHT / cellSize(1536, 1872).h).sheetWidth, true);
check('fallback sheet geometry is whole pixels', painted % 1 === 0, true);
check('fallback spinner cleared', fallback.querySelectorAll('.pdx-spinner').length, 0);
check('dead pet spinner cleared too, no infinite ring', dead.querySelectorAll('.pdx-spinner').length, 0);

console.log('\n10. the selected pet is marked with a check, not just a border colour');
search.value = '';
search.fire('input');
await tick(150);
const first = cards()[0];
check('every card carries a check span', cards().length === [...cards()].filter(c => c.querySelector('.pdx__check')).length, true);
check('the check is a tick, not a bullet', first.querySelector('.pdx__check').textContent, '\u2713');
/* the check is decoration: aria-pressed is what a screen reader announces,
   and a second "selected" signal would be read out twice */
check('the check is hidden from assistive tech', first.querySelector('.pdx__check').getAttribute('aria-hidden'), 'true');
first.fire('click');
check('clicking marks the card', first.getAttribute('aria-pressed'), 'true');
check('exactly one card is selected', [...cards()].filter(c => c.getAttribute('aria-pressed') === 'true').length, 1);
check('the previously active card lost the mark', cards()[1].getAttribute('aria-pressed'), 'false');

console.log('\n11. rebuilding the section retires the one before it');
/* Settings discards a section on every switch without calling a cleanup, so
   the build fn has to tear the previous tree down itself. */
const previousRoot = root;
paint();
const nextRoot = contentHost.children[0];
check('a fresh tree was built', nextRoot === previousRoot, false);
check('exactly one tree is mounted', contentHost.children.length, 1);
check('the old tree detached itself', previousRoot.parentNode, null);
check('the new tree is the live one', nextRoot.querySelector('.pdx__grid') !== null, true);
check('the new grid is empty until the catalogue lands', nextRoot.querySelector('.pdx__loading') !== null, true);
/* from here on the checks run against the tree Settings is actually holding */
root = nextRoot;
grid = root.querySelector('.pdx__grid');
search = root.querySelector('input');
count = root.querySelector('.pdx__count');

console.log('\n12. runtime snapshot selects working animation immediately on activation');
await tick();
settle();
const overlay = document.body.querySelector('.pdx-float');
const stage = overlay?.querySelector('.pdx-float__stage');
check('overlay mounted', !!stage, true);
check('active pane working state selects running row', stage.style.props.get('--pdx-y'), '-840px');
check('the pet stands alone — no hover or drag label', overlay.querySelectorAll('.pdx-float__label').length, 0);
check('the busy ring survives the label going away', !!overlay.querySelector('.pdx-float__busy'), true);

console.log('\n13. per-pet direction override persists and changes drag row');
const directionToggle = nextRoot.children[2].children[0];
check('direction control exists', !!directionToggle, true);
directionToggle.checked = true;
directionToggle.fire('change');
await tick();
check('direction override persisted for active pet', saved.get('reversed-pets').includes('pet-0'), true);
stage.fire('pointerdown', { clientX: 500, clientY: 300, pointerId: 1 });
stage.fire('pointermove', { clientX: 520, clientY: 300 });
check('reversed pet maps right drag to left-facing row', stage.style.props.get('--pdx-y'), '-240px');
stage.fire('pointerup', { pointerId: 1 });
check('release restores working row', stage.style.props.get('--pdx-y'), '-840px');

console.log('\n14. ambient animations randomize between waving and review, then restore base state');
runtimeStatusListener({ 'pane-1': { running: false, state: 'idle' } });
const intervalCallback = intervals[intervals.length - 1];
const random = Math.random;
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => {
  timeouts.push(fn);
  timeoutDurations.push(ms);
  return timeouts.length;
};
Math.random = () => 0;
intervalCallback();
check('first ambient cycle is waving', stage.style.props.get('--pdx-y'), '-360px');
check('waving plays two cycles', timeoutDurations.at(-1), 1400);
timeouts.shift()();
check('ambient cycle restores idle state', stage.style.props.get('--pdx-y'), '0px');
Math.random = () => 0.9;
intervalCallback();
check('next ambient cycle is review', stage.style.props.get('--pdx-y'), '-960px');
check('review plays two cycles', timeoutDurations.at(-1), 2060);
timeouts.shift()();
check('review cycle restores idle state', stage.style.props.get('--pdx-y'), '0px');
Math.random = random;
globalThis.setTimeout = nativeSetTimeout;

console.log('\n15. every card carries the maker and the two counts');
search.value = '';
search.fire('input');
await tick(150);
check('maker line', cards()[0].querySelector('.pdx__by').textContent, 'by maker-0');
check('counts line', cards()[0].querySelector('.pdx__stats').textContent, '↓ 12k♥ 26');
check('three-digit counts keep their digits', cards()[1].querySelector('.pdx__stats').textContent, '↓ 910♥ 1.7k');
check('title spells them out for hover', cards()[1].title, 'Pet 129 — by maker-1 · 910 installs · 1,690 loves');

console.log('\n16. the sort control reorders the whole grid');
const sort = root.querySelector('.pdx__sort');
check('sort defaults to the order petdex.dev opens on', sort.value, 'installed');
check('it wears the host dropdown class, not a lookalike', sort.classes().includes('select-input'), true);
check('most installed first', cards()[0].querySelector('.pdx__name').textContent, 'Pet 0');
sort.value = 'loved';
sort.fire('change');
check('most loved first', cards()[0].querySelector('.pdx__name').textContent, 'Pet 129');
sort.value = 'recent';
sort.fire('change');
check('newest first', cards()[0].querySelector('.pdx__name').textContent, 'Total Gone');
sort.value = 'alpha';
sort.fire('change');
check('A to Z first', cards()[0].querySelector('.pdx__name').textContent, 'Pet 0');
sort.value = 'installed';
sort.fire('change');
check('back to most installed', cards()[0].querySelector('.pdx__name').textContent, 'Pet 0');

console.log('\n17. kind chips filter and carry the facet counts');
const chips = root.querySelector('.pdx__chips').querySelectorAll('.pdx__chip');
check('four chips', chips.length, 4);
check('all pressed to start', chips[0].getAttribute('aria-pressed'), 'true');
check('all facet count', chips[0].textContent, 'All 132');
check('creature facet count', chips[1].textContent, 'Creature 46');
chips[3].fire('click');
check('clicking filters', cards().length, 43);
check('chip shows it is on', chips[3].getAttribute('aria-pressed'), 'true');
check('the previous chip released', chips[0].getAttribute('aria-pressed'), 'false');
check('the count follows the filter', count.textContent, 'active: Pet 0 — 43 pets');
chips[0].fire('click');
check('All restores the grid', cards().length, 48);

console.log('\n18. search reaches description, tags and vibes, and the maker');
const search1 = async (q, ms = 150) => { search.value = q; search.fire('input'); await tick(ms); };
await search1('cozy');
check('vibes are searchable', count.textContent, 'active: Pet 0 — 130 pets');
check('only the first page is on screen', cards().length, 48);
await search1('tag-77');
check('tags are searchable', cards().length, 1);
check('and it is the right pet', cards()[0].querySelector('.pdx__name').textContent, 'Pet 77');
await search1('specimen aa');
check('description words are searchable', cards().length, 5);
check('and they land on the right pets', cards()[0].querySelector('.pdx__name').textContent, 'Pet 0');
await search1('maker-3');
check('maker names are searchable (petdex.dev returns nothing for these)', cards().length, 32);
await search1('maker-3 zzz');
check('no match when any token misses', cards().length, 0);
await search1('');

console.log(`\n${failed ? `${failed} FAILED` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
