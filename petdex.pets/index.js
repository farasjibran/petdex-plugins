/* Petdex Pets — a Bentomux plugin.
 *
 * A draggable pet that floats over the app and reacts to the terminal you are
 * actually looking at: a working agent makes it run, a blocked one or a pending
 * approval makes it wait. Settings → Petdex browses petdex.dev and picks the pet.
 *
 * Everything registered here is declared in plugin.json first. See
 * bentomux-plugin-sdk.d.ts for the context API. */

import {
  ANIMATION,
  CELL_H,
  KEYFRAMES,
  STATES,
  atlasVars,
  cellSize,
  dragStateFor,
  petStateFor,
  stripVars,
} from './sprite.js';

const MANIFEST_URL = 'https://petdex.dev/api/manifest/v2';
/* installs, loves and the search text (description, tags, vibes) — see
   refresh.mjs for why these are bundled rather than fetched */
const SNAPSHOT_URL = new URL('./pets.json', import.meta.url);
const ASSET_BASE = 'https://assets.petdex.dev';
const DEFAULT_PET = 'boba';
const PAGE = 48;
const PET_HEIGHT = 120;
const THUMB_HEIGHT = 72;
export { THUMB_HEIGHT };
const EDGE = 8;
const AMBIENT_INTERVAL_MS = 30_000;

const REVERSED_PETS_KEY = 'reversed-pets';

/* the sorts petdex.dev offers, minus `curated`, which is a shuffled selection
   rather than an order and needs a seed the API hands back */
const SORTS = {
  installed: { label: 'Most installed', cmp: (a, b) => b.installs - a.installs },
  loved: { label: 'Most loved', cmp: (a, b) => b.loves - a.loves },
  recent: { label: 'Newest', cmp: (a, b) => (a.approved < b.approved ? 1 : -1) },
  alpha: { label: 'A to Z', cmp: (a, b) => a.name.localeCompare(b.name) },
};
const KINDS = ['creature', 'character', 'object'];

/* the catalogue is ~4.8k rows, well past the 1 MB storage cap, so it stays in
   memory for the session and only the chosen slug is persisted */
let catalogue = null;
/* slug -> snapshot row [slug, installs, loves, description, vibes, tags, approved] */
let metrics = null;
let metricsPromise = null;
let active = DEFAULT_PET;
let storage = null;
let reversedPets = new Set();
let ctx = null;
const subscribers = new Set();

const thumbUrl = slug => `${ASSET_BASE}/pets/${slug}/preview.webp`;

/** 11250 -> "11.3k", 940 -> "940", 12000 -> "12k" */
function fmtCount(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k`;
}

async function loadCatalogue() {
  if (catalogue) {
    /* the overlay can win the race and put the grid in front of a picker that
       opens mid-flight, so an already-built catalogue still waits for the
       counts before a search would run against empty haystacks */
    await metricsPromise;
    return catalogue;
  }
  const res = await fetch(MANIFEST_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`petdex manifest returned ${res.status}`);
  const data = await res.json();
  /* the manifest ships column tuples to keep the payload small. The trailing
     sprite version is deliberately dropped: it disagrees with the real sheet on
     ~1 pet in 5, and `rowsForSheet` reads the row count off the image instead. */
  catalogue = data.pets.map(([slug, name, kind, by, sprite]) => ({
    slug,
    name,
    kind,
    by: by || 'unknown',
    installs: 0,
    loves: 0,
    approved: '',
    sprite: `${ASSET_BASE}/${sprite}`,
    hay: '',
  }));
  metricsPromise = loadMetrics();
  await metricsPromise;
  return catalogue;
}

/**
 * Attach the bundled counts and search text to every catalogue row.
 *
 * Missing snapshot is not fatal: the manifest alone still lists every pet, and
 * the cards fall back to showing no counts rather than a fake zero. That also
 * keeps an older copy of the plugin folder working after this change.
 */
async function loadMetrics() {
  if (metrics) return;
  try {
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error(`pets.json returned ${res.status}`);
    const data = await res.json();
    const rows = new Map();
    for (const row of data.pets) rows.set(row[0], row);
    /* assigned only once the whole file parsed, so a failed read is a retry
       on the next open rather than a catalogue with no counts for the session */
    metrics = rows;
  } catch (err) {
    ctx?.log('petdex.pets: no bundled counts —', err);
    return;
  }
  for (const pet of catalogue) {
    const row = metrics.get(pet.slug);
    if (row) {
      pet.installs = row[1];
      pet.loves = row[2];
      pet.approved = row[6];
      /* one lowercase haystack per pet, so a keystroke is an includes per token
         instead of a field-by-field scan over 4.8k rows */
      pet.hay = `${pet.name} ${pet.slug} ${pet.kind} ${pet.by} ${row[3]} ${row[4].join(' ')} ${row[5].join(' ')}`.toLowerCase();
    } else {
      pet.hay = `${pet.name} ${pet.slug} ${pet.kind} ${pet.by}`.toLowerCase();
    }
  }
}

/**
 * Does this pet match every token, and how well?
 *
 * petdex.dev's `q` is a keyword AND over name, slug, description, tags and
 * vibes, with the maker name deliberately not indexed. This is the same
 * matcher plus the maker, which is the one field worth searching that petdex
 * leaves out.
 */
function score(pet, tokens) {
  const name = pet.name.toLowerCase();
  let best = Infinity;
  for (const token of tokens) {
    if (!pet.hay.includes(token)) return Infinity;
    /* the best any single token can do decides the row: a pet whose name
       matches beats one that only mentions the word in its description */
    const at = name.indexOf(token);
    const here = at === 0 ? 0 : at > 0 ? 1 : 2;
    if (here < best) best = here;
  }
  return best;
}

async function choosePet(slug) {
  active = slug;
  for (const notify of subscribers) notify(slug);
  try {
    await storage?.set('pet', slug);
  } catch (err) {
    /* the pick still stands for this session; a failed write only costs it
       across restarts, so say so instead of letting it look like a dead click */
    ctx?.log('petdex.pets: could not save the pick —', err);
  }
}

const CHROME = `
${KEYFRAMES}
@keyframes pdx-spin { to { transform:rotate(1turn) } }

/* One busy ring, three sizes of job. A placeholder that occupies the space it
   is standing in for is what makes a slow image look slow instead of broken. */
.pdx-spinner { width:18px; height:18px; flex:0 0 auto; border-radius:50%;
  border:2px solid var(--line-2); border-top-color:var(--accent);
  animation:pdx-spin .7s linear infinite; }
.pdx-spinner--sm { width:14px; height:14px; }
.pdx__loading { display:flex; align-items:center; gap:8px; padding:24px 0;
  color:var(--ink-3); font:13px var(--sans); }

/* every sprite in the plugin: the floating pet and each picker thumbnail.
   One @keyframes rule, geometry per element, so a grid of 48 animated cards
   costs the same as one pet. Every property paint() sets has to be read here
   or the sheet renders at natural size inside a scaled-down box. */
.pdx-sprite { --pdx-w:auto; --pdx-h:auto; --pdx-end:0px; --pdx-y:0px; --pdx-ms:1100ms; --pdx-frames:6;
  background-image:var(--pdx-url); background-size:var(--pdx-w) var(--pdx-h);
  background-repeat:no-repeat; background-position:0 var(--pdx-y);
  image-rendering:pixelated;
  animation:pdx-pet var(--pdx-ms) steps(var(--pdx-frames)) infinite; }

/* An always-running pet is exactly what this setting is for: hold the first
   frame instead of removing the sprite, so the pet is still there to drag. */
@media (prefers-reduced-motion: reduce) {
  .pdx-sprite { animation:none; }
  .pdx-spinner { animation-duration:2.4s; }
}

.pdx { display:flex; flex-direction:column; gap:10px; }
.pdx__bar { display:flex; gap:8px; align-items:center; }
.pdx__bar input { flex:1; padding:6px 8px; border-radius:6px;
  border:1px solid var(--line-2); background:var(--bg); color:var(--ink); font:13px var(--sans); }
.pdx__count { font:12px var(--sans); color:var(--ink-3); white-space:nowrap; }
/* .select-input is the host's own select class, so the dropdown wears the same
   chevron, hover and focus ring as every other select in the app. Only the
   width is ours: the bar is a flex row, and 100% would eat the search box. */
.pdx__sort { width:auto; flex:0 0 auto; }
.pdx__chips { display:flex; flex-wrap:wrap; gap:6px; }
.pdx__chip { padding:3px 10px; border-radius:999px; border:1px solid var(--line);
  background:var(--bg); color:var(--ink-2); font:11px var(--sans); cursor:pointer; }
.pdx__chip:hover { border-color:var(--line-2); background:var(--tint); }
.pdx__chip[aria-pressed="true"] { border-color:var(--accent); color:var(--ink); background:var(--tint); }
.pdx__chip:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.pdx__chip span { color:var(--ink-3); }
.pdx__direction { display:flex; align-items:center; gap:7px;
  color:var(--ink-2); font:12px var(--sans); cursor:pointer; }
.pdx__direction input { accent-color:var(--accent); }
.pdx__grid { display:grid; gap:10px;
  grid-template-columns:repeat(auto-fill, minmax(104px, 1fr)); }
.pdx__card { position:relative; display:flex; flex-direction:column; align-items:center; gap:4px;
  padding:8px 6px; border-radius:8px; border:1px solid var(--line);
  background:var(--bg); color:var(--ink-2); cursor:pointer; font:11px/1.3 var(--sans); }
.pdx__card:hover { border-color:var(--line-2); background:var(--tint); }
/* The selected pet is the one thing in this section that must read as "on" at
   a glance, so it gets green plus a check instead of a border colour change
   alone. Green is a literal pair, matching the diff page's addition tint —
   there is no --ok token in the palette and no palette ships one that stays
   readable against every theme's --bg. */
.pdx__card[aria-pressed="true"] { border-color:#1a7f37; background:rgba(26,127,55,.10); color:var(--ink); }
:root.dark .pdx__card[aria-pressed="true"] { border-color:#7ee787; background:rgba(46,160,67,.15); }
.pdx__check { position:absolute; top:3px; right:5px; display:none;
  font:700 11px/1 var(--sans); color:#1a7f37; }
:root.dark .pdx__check { color:#7ee787; }
.pdx__card[aria-pressed="true"] .pdx__check { display:block; }
.pdx__card:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.pdx__card--more { justify-content:center; color:var(--ink-3); min-height:126px; }
/* 72px keeps a 192x208 cell's aspect while leaving room for the name below.
   It is a flex box so the busy ring can sit in the gap the sprite will fill. */
.pdx__thumb { width:66px; height:72px; display:flex;
  align-items:center; justify-content:center; }
.pdx__name { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pdx__by { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--ink-3); font-size:10px; }
.pdx__stats { display:flex; gap:6px; color:var(--ink-3); font:10px/1 var(--sans); }

/* the floating pet. Fixed to the window, not to a page, so it survives tab
   switches, workspace switches and the welcome page alike. */
.pdx-float { position:fixed; z-index:2147483000; display:flex;
  flex-direction:column; align-items:center; gap:2px;
  touch-action:none; user-select:none; -webkit-user-select:none; }
.pdx-float__stage { cursor:grab; pointer-events:auto; }
.pdx-float__stage:active { cursor:grabbing; }
.pdx-float__busy { display:none; }
.pdx-float[data-busy="true"] .pdx-float__busy { display:block; }
`;

/** One <style> for the whole plugin, created on first use. */
function chromeStyle() {
  let style = document.getElementById('petdex-pets-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'petdex-pets-style';
    style.textContent = CHROME;
    document.head.append(style);
  }
  return style;
}

/**
 * Show or remove the busy ring inside an element.
 *
 * A ring is a claim that something is in flight. It belongs on the atlas the
 * overlay is fetching and on a thumbnail that has not decoded yet — not on a
 * card whose picture is already there, which would be a spinner for nothing.
 */
function busy(el, on) {
  const ring = el.querySelector(':scope > .pdx-spinner');
  if (on && !ring) {
    const made = document.createElement('span');
    made.className = 'pdx-spinner pdx-spinner--sm';
    el.append(made);
  } else if (!on && ring) {
    ring.remove();
  }
}

/** Point a `.pdx-sprite` element at one row of a sheet, or at a preview strip. */
function paint(el, v) {
  el.style.setProperty('--pdx-url', `url("${v.url}")`);
  el.style.setProperty('--pdx-w', `${v.sheetWidth}px`);
  el.style.setProperty('--pdx-h', `${v.sheetHeight}px`);
  el.style.setProperty('--pdx-y', `${v.y}px`);
  el.style.setProperty('--pdx-end', `${v.end}px`);
  el.style.setProperty('--pdx-ms', `${v.ms}ms`);
  el.style.setProperty('--pdx-frames', String(v.frames));
  el.style.width = `${v.cell.w}px`;
  el.style.height = `${v.cell.h}px`;
}

/**
 * Measure a sheet, then paint it. A 404 leaves the caller with an element that
 * still shows whatever it had, so the atlas fallback can take over.
 */
function measure(url, done, failed) {
  const probe = new Image();
  probe.onload = () => done(probe.naturalWidth, probe.naturalHeight);
  probe.onerror = () => failed();
  probe.src = url;
}

/* ---------------- the floating pet ---------------- */

function mountOverlay() {
  chromeStyle();
  const root = document.createElement('div');
  root.className = 'pdx-float';
  const stage = document.createElement('div');
  stage.className = 'pdx-float__stage pdx-sprite';
  const busyRing = document.createElement('span');
  busyRing.className = 'pdx-spinner pdx-spinner--sm pdx-float__busy';
  root.append(stage, busyRing);
  document.body.append(root);

  let pet = null;
  let sheet = null;
  let playing = '';
  let ambientState = null;
  let ambientReset = null;
  let statuses = {};
  let paneId = null;
  /* pane ids with an unresolved approval; a pending permission is global
     because Bentomux's own prompt is global. Keyed by request id because that
     is all the close notice carries. */
  const pending = new Map();
  let gone = false;

  const onPet = () => void load();
  subscribers.add(onPet);

  const offTab = ctx.events.on('tab:activated', payload => {
    paneId = payload?.paneId ?? null;
    apply();
  });
  const offStatus = ctx.app.onRuntimeStatus(next => {
    statuses = next;
    apply();
  });
  const offApproval = ctx.app.onAgentApproval(req => {
    /* the close notice names the request, not the pane, so keep the mapping */
    if (req?.paneId) pending.set(req.requestId, req.paneId);
    apply();
  });
  const offApprovalClosed = ctx.app.onAgentApprovalClosed(requestId => {
    pending.delete(requestId);
    apply();
  });

  async function load() {
    clearAmbient();
    let found;
    /* the atlas is 1-2 MB and is not cached after a restart, so the swap is
       visible. The previous pet stays on screen while this one arrives: an
       empty corner is worse than a pet one beat behind. */
    root.dataset.busy = 'true';
    try {
      found = findPet(active) || (await loadCatalogue()).find(p => p.slug === active);
    } catch (err) {
      if (!gone) {
        root.dataset.busy = 'false';
        ctx?.log('petdex.pets: petdex unreachable —', err.message);
      }
      return;
    }
    if (gone) return;
    if (!found) {
      root.dataset.busy = 'false';
      ctx?.log(`petdex.pets: pet "${active}" is not in the petdex catalogue`);
      return;
    }
    pet = found;
    sheet = { width: 0, height: 0 };
    /* the sheet decides its own cell size, so scaled variants just work */
    measure(pet.sprite, (w, h) => {
      if (gone || pet !== found) return;
      sheet.width = w;
      sheet.height = h;
      playing = '';
      apply();
      root.dataset.busy = 'false';
    }, () => {
      if (gone) return;
      root.dataset.busy = 'false';
      ctx?.log(`petdex.pets: could not load the sheet for ${pet.name}`);
    });
  }

  function apply() {
    if (gone || !sheet?.width) return;
    const baseState = petStateFor(statuses, paneId, new Set(pending.values()));
    if (baseState !== 'idle') clearAmbient();
    const state = drag?.state || (baseState === 'idle' && ambientState) || baseState;
    const scale = PET_HEIGHT / cellSize(sheet.width, sheet.height).h;
    paint(stage, atlasVars(pet.sprite, sheet.width, sheet.height, state, scale));
    /* the pet has a size now, so re-clamp: the corner it was dropped in was
       chosen against a zero-size box */
    if (playing !== pet.slug + state) {
      playing = pet.slug + state;
      place(root.offsetLeft, root.offsetTop);
    }
  }

  function clearAmbient() {
    if (ambientReset !== null) clearTimeout(ambientReset);
    ambientReset = null;
    ambientState = null;
  }

  function playAmbient() {
    if (gone || drag || !sheet?.width) return;
    if (petStateFor(statuses, paneId, new Set(pending.values())) !== 'idle') return;
    clearAmbient();
    const state = Math.random() < 0.5 ? 'waving' : 'review';
    ambientState = state;
    apply();
    ambientReset = setTimeout(() => {
      ambientState = null;
      ambientReset = null;
      apply();
    }, STATES[state].ms * 2);
  }

  const ambientInterval = setInterval(playAmbient, AMBIENT_INTERVAL_MS);

  /* ---- dragging ---- */

  const place = (x, y) => {
    const w = root.offsetWidth || 100;
    const h = root.offsetHeight || PET_HEIGHT;
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - w - EDGE));
    const top = Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };

  let drag = null;
  stage.addEventListener('pointerdown', event => {
    clearAmbient();
    const box = root.getBoundingClientRect();
    drag = { dx: event.clientX - box.left, dy: event.clientY - box.top, lastX: event.clientX, travelX: 0, state: null };
    apply();
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  stage.addEventListener('pointermove', event => {
    if (!drag) return;
    drag.travelX += event.clientX - drag.lastX;
    drag.lastX = event.clientX;
    if (Math.abs(drag.travelX) >= 12) {
      drag.state = dragStateFor(
        drag.travelX > 0,
        reversedPets.has(pet.slug),
      );
      drag.travelX = 0;
      apply();
    }
    place(event.clientX - drag.dx, event.clientY - drag.dy);
  });
  const drop = event => {
    if (!drag) return;
    drag = null;
    stage.releasePointerCapture?.(event.pointerId);
    apply();
    void savePos(root.offsetLeft, root.offsetTop);
  };
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);

  /* restoring the saved corner; the default is the bottom-right of the window,
     which is where a desktop pet belongs and where it covers least */
  const clampIntoView = () => place(root.offsetLeft, root.offsetTop);
  window.addEventListener('resize', clampIntoView);
  void storage
    ?.get('pos')
    .then(saved => {
      if (gone) return;
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        place(saved.x, saved.y);
      } else {
        place(window.innerWidth - 120, window.innerHeight - PET_HEIGHT - EDGE);
      }
    })
    .catch(() => place(window.innerWidth - 120, window.innerHeight - PET_HEIGHT - EDGE));

  void load();
  return () => {
    gone = true;
    subscribers.delete(onPet);
    offTab();
    offStatus();
    offApproval();
    offApprovalClosed();
    clearInterval(ambientInterval);
    clearAmbient();
    window.removeEventListener('resize', clampIntoView);
    root.remove();
  };
}

const findPet = slug => catalogue?.find(pet => pet.slug === slug) || null;

function savePos(x, y) {
  return storage?.set('pos', { x, y }).catch(err => {
    ctx?.log('petdex.pets: could not save the pet position —', err);
  });
}

/* ---------------- picker ---------------- */

/* Settings throws a section's DOM away on every switch and never calls a
   cleanup, so each build retires the one before it. Without this, leaving and
   re-entering Settings leaves a live 120ms debounce timer and a set of in-flight
   image probes writing into a detached tree. */
let retirePicker = null;

function picker() {
  retirePicker?.();
  retirePicker = null;
  const root = document.createElement('div');
  root.className = 'pdx';
  const bar = document.createElement('div');
  bar.className = 'pdx__bar';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search pets, makers, tags…';
  const sort = document.createElement('select');
  /* the host's shared select class, so it is the app's dropdown and not a
     second one that happens to sit next to it */
  sort.className = 'pdx__sort select-input';
  sort.dataset.testid = 'petdex-input-sort';
  sort.setAttribute('aria-label', 'Sort pets');
  for (const [key, entry] of Object.entries(SORTS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = entry.label;
    sort.append(option);
  }
  sort.value = 'installed';
  const count = document.createElement('div');
  count.className = 'pdx__count';
  const chips = document.createElement('div');
  chips.className = 'pdx__chips';
  const grid = document.createElement('div');
  const directionLabel = document.createElement('label');
  directionLabel.className = 'pdx__direction';
  const directionToggle = document.createElement('input');
  directionToggle.type = 'checkbox';
  directionToggle.setAttribute('aria-label', 'Reverse drag direction for active pet');
  directionToggle.dataset.testid = 'petdex-input-reverse-direction';
  const directionText = document.createElement('span');
  directionText.textContent = 'Reverse drag direction for active pet';
  directionLabel.append(directionToggle, directionText);
  grid.className = 'pdx__grid';
  bar.append(search, sort, count);
  root.append(bar, chips, directionLabel, grid);

  /* one chip per kind, plus the counts of what the current search leaves —
     the same facet counts petdex.dev shows, so a filter that would return
     nothing is visible as a 0 before it is clicked */
  let kind = '';
  const chipCount = new Map();
  const chip = (key, label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pdx__chip';
    button.dataset.kind = key;
    const text = document.createElement('span');
    text.textContent = '0';
    button.append(document.createTextNode(`${label} `), text);
    button.addEventListener('click', () => {
      kind = key;
      for (const other of chips.querySelectorAll('.pdx__chip')) {
        other.setAttribute('aria-pressed', String(other.dataset.kind === kind));
      }
      filter();
    });
    chipCount.set(key, text);
    chips.append(button);
  };
  chip('', 'All');
  for (const one of KINDS) chip(one, one[0].toUpperCase() + one.slice(1));
  chips.firstChild.setAttribute('aria-pressed', 'true');

  const faceting = base => {
    const tally = new Map([['', base.length]]);
    for (const one of KINDS) tally.set(one, 0);
    for (const pet of base) tally.set(pet.kind, (tally.get(pet.kind) ?? 0) + 1);
    for (const [key, node] of chipCount) node.textContent = String(tally.get(key) ?? 0);
  };
  directionToggle.checked = reversedPets.has(active);
  directionToggle.addEventListener('change', () => {
    if (directionToggle.checked) reversedPets.add(active);
    else reversedPets.delete(active);
    void storage?.set(REVERSED_PETS_KEY, [...reversedPets]).catch(err => {
      ctx?.log('petdex.pets: could not save drag direction —', err);
    });
  });

  let matches = [];
  let shown = PAGE;
  let gone = false;
  let moreBtn = null;
  let cursor = null;
  let typeTimer = 0;
  /* bumped on every redraw so image probes belonging to cards that have left
     the grid stop bothering the network */
  let drawId = 0;

  /* the manifest is 4.8k rows; the warm service usually has it before this
     tab opens, so this only shows on a cold start or after a failed warm */
  const note = (msg, spinning) => {
    grid.textContent = '';
    const row = document.createElement('div');
    row.className = 'pdx__loading';
    if (spinning) {
      const ring = document.createElement('span');
      ring.className = 'pdx-spinner';
      row.append(ring);
    }
    row.append(document.createTextNode(msg));
    grid.append(row);
  };
  note('Loading 4,800+ pets from petdex.dev…', true);

  const mark = (card, pet) => {
    for (const other of grid.querySelectorAll('.pdx__card')) {
      other.setAttribute('aria-pressed', 'false');
    }
    card.setAttribute('aria-pressed', 'true');
    count.textContent = `active: ${pet.name}`;
    if (cursor) cursor.tabIndex = -1;
    cursor = card;
    card.tabIndex = 0;
  };

  const cardFor = (pet, first) => {
    const token = drawId;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pdx__card';
    /* one tab stop for the whole grid; arrows do the walking from there */
    card.tabIndex = first ? 0 : -1;
    card.setAttribute('aria-pressed', String(pet.slug === active));
    const counted = metrics?.get(pet.slug);
    card.title = counted
      ? `${pet.name} — by ${pet.by} · ${pet.installs.toLocaleString()} installs · ${pet.loves.toLocaleString()} loves`
      : `${pet.name} — by ${pet.by}`;
    const thumb = document.createElement('div');
    thumb.className = 'pdx__thumb pdx-sprite';
    /* the preview is one row cut out of the atlas — idle, 6 frames — so the
       card animates from the ~40 KB image it was already fetching, not from
       the multi-megabyte sheet. Previews can be missing (petdex #579), so a
       failed probe falls back to cropping the atlas instead. */
    const url = thumbUrl(pet.slug);
    const settle = () => {
      if (gone || drawId !== token) return;
      busy(thumb, false);
    };
    busy(thumb, true);
    measure(
      url,
      (w, h) => {
        if (gone || drawId !== token) return;
        paint(thumb, stripVars(url, w, h, THUMB_HEIGHT / h));
        settle();
      },
      () => {
        if (gone || drawId !== token) return;
        measure(pet.sprite, (w, h) => {
          if (gone || drawId !== token) return;
          const scale = THUMB_HEIGHT / cellSize(w, h).h;
          paint(thumb, atlasVars(pet.sprite, w, h, 'idle', scale));
          settle();
        }, settle);
      },
    );
    const check = document.createElement('span');
    check.className = 'pdx__check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '\u2713';
    const name = document.createElement('div');
    name.className = 'pdx__name';
    name.textContent = pet.name;
    const by = document.createElement('div');
    by.className = 'pdx__by';
    by.textContent = `by ${pet.by}`;
    const stats = document.createElement('div');
    stats.className = 'pdx__stats';
    /* a pet the snapshot has no row for shows nothing rather than "0" — those
       two read as very different claims about a pet people can go install */
    if (counted) {
      const installs = document.createElement('span');
      installs.textContent = `↓ ${fmtCount(pet.installs)}`;
      const loves = document.createElement('span');
      loves.textContent = `♥ ${fmtCount(pet.loves)}`;
      stats.append(installs, loves);
    }
    card.append(check, thumb, name, by, stats);
    card.addEventListener('click', () => {
      void choosePet(pet.slug);
      directionToggle.checked = reversedPets.has(pet.slug);
      directionToggle.setAttribute(
        'aria-label',
        `Reverse drag direction for ${pet.name}`,
      );
      mark(card, pet);
    });
    card.addEventListener('focus', () => {
      /* the tab stop has to travel with the focus. Without re-arming it here
         the grid ends up with zero tabbable cards the moment an arrow key is
         pressed, and Tab drops the user straight out of the picker. */
      if (cursor && cursor !== card) cursor.tabIndex = -1;
      cursor = card;
      card.tabIndex = 0;
    });
    return card;
  };

  /**
   * Add cards for `matches[from, to)` and leave the pager last.
   *
   * Appending rather than redrawing is the whole point: a redraw would rebuild
   * the 48 cards already on screen, restart their idle loops at frame zero and
   * re-probe every image the user has already seen.
   */
  const append = (from, to) => {
    const frag = document.createDocumentFragment();
    for (const pet of matches.slice(from, to)) frag.append(cardFor(pet, false));
    if (frag.childNodes.length) {
      const roving = !grid.querySelector('.pdx__card');
      if (roving) frag.firstChild.tabIndex = 0;
      grid.append(frag);
    }
    if (moreBtn) grid.append(moreBtn);
  };

  const draw = () => {
    drawId += 1;
    grid.textContent = '';
    moreBtn = null;
    cursor = null;
    const pick = findPet(active);
    count.textContent = pick
      ? `active: ${pick.name} — ${matches.length} pets`
      : `${matches.length} pets`;
    if (!matches.length) {
      note('No pets match that search.', false);
      return;
    }
    append(0, Math.min(shown, matches.length));
    if (shown < matches.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'pdx__card pdx__card--more';
      more.textContent = `Show ${Math.min(PAGE, matches.length - shown)} more`;
      more.addEventListener('click', () => {
        const from = shown;
        shown = Math.min(shown + PAGE, matches.length);
        append(from, shown);
        const left = matches.length - shown;
        if (left <= 0) {
          more.remove();
          moreBtn = null;
        } else {
          more.textContent = `Show ${Math.min(PAGE, left)} more`;
        }
      });
      moreBtn = more;
      grid.append(more);
    }
  };

  /* arrows walk the grid, so the layout decides what a row is rather than a
     hardcoded column count that breaks at every window width */
  const columnCount = () => {
    const cards = grid.querySelectorAll('.pdx__card:not(.pdx__card--more)');
    if (!cards.length) return 1;
    const top = cards[0].offsetTop;
    let n = 0;
    while (n < cards.length && cards[n].offsetTop === top) n += 1;
    return Math.max(1, n);
  };

  grid.addEventListener('keydown', event => {
    const cards = [...grid.querySelectorAll('.pdx__card:not(.pdx__card--more)')];
    if (!cards.length) return;
    const at = cursor ? cards.indexOf(cursor) : -1;
    const jump = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columnCount(), ArrowUp: -columnCount() }[event.key];
    const next =
      jump !== undefined
        ? cards[Math.max(0, Math.min(cards.length - 1, (at < 0 ? 0 : at) + jump))]
        : event.key === 'Home'
          ? cards[0]
          : event.key === 'End'
            ? cards[cards.length - 1]
            : event.key === 'Escape'
              ? search
              : null;
    if (!next) return;
    event.preventDefault();
    /* focus() is native roving tabindex: it moves the one tab stop with it */
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  });

  const filter = () => {
    if (!catalogue) return;
    const tokens = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    /* petdex keyword search ANDs the tokens; rank lifts name hits above
       description hits and the chosen sort breaks the rest */
    const base = [];
    for (const pet of catalogue) {
      if (tokens.length) {
        const rank = score(pet, tokens);
        if (rank === Infinity) continue;
        if (rank) {
          base.push([rank, pet]);
          continue;
        }
      }
      base.push([0, pet]);
    }
    faceting(base.map(entry => entry[1]));
    const cmp = SORTS[sort.value]?.cmp || SORTS.installed.cmp;
    matches = (kind ? base.filter(([, pet]) => pet.kind === kind) : base)
      .sort((a, b) => a[0] - b[0] || cmp(a[1], b[1]) || a[1].slug.localeCompare(b[1].slug))
      .map(([, pet]) => pet);
    shown = PAGE;
    draw();
  };

  /* 4,871 entries filter in under a millisecond, but each redraw builds up to
     48 cards and probes 48 images — per keystroke that is a 48-image storm */
  search.addEventListener('input', () => {
    clearTimeout(typeTimer);
    typeTimer = setTimeout(filter, 120);
  });
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(typeTimer);
    filter();
  });
  sort.addEventListener('change', () => {
    shown = PAGE;
    filter();
  });
  loadCatalogue().then(
    () => !gone && filter(),
    err => {
      count.textContent = '';
      note(`Could not reach petdex.dev — ${err.message}`, false);
    },
  );

  retirePicker = () => {
    gone = true;
    clearTimeout(typeTimer);
    root.remove();
  };
  return root;
}

/* ---------------- entry ---------------- */

export function activate(context) {
  ctx = context;
  storage = context.storage;
  chromeStyle();

  let overlay = null;
  const showOverlay = (on) => {
    if (on && !overlay) overlay = mountOverlay();
    if (!on && overlay) {
      overlay();
      overlay = null;
    }
  };
  context.dispose(() => showOverlay(false));

  context.ui.command('petdex.pets.toggle-overlay', () => {
    const prefs = ctx.storage;
    void prefs
      .get('hidden')
      .then(hidden => {
        const next = !hidden;
        showOverlay(!next);
        return prefs.set('hidden', next);
      })
      .catch(err => ctx.log('petdex.pets: could not save visibility —', err));
  });

  /* The picker is a settings section rather than a topbar button or a tab: it
     is a place you go to choose something once, not a destination you keep
     open, and the host only lists it in the settings menu while this plugin is
     active, so the section appears and disappears with the install. */
  context.ui.settingsSection('petdex.pets.picker', picker);

  /* A plugin with only UI contributions stays inactive until something is
     clicked, which is right for a button and wrong for a pet: it is supposed
     to be reacting before you touch anything. Declaring a service is the
     documented way to make the host activate at boot, and fetching the
     catalogue here means the picker opens with no spinner. */
  context.ui.service('petdex.pets.warm', async signal => {
    if (signal.aborted) return;
    try {
      await loadCatalogue();
    } catch (err) {
      ctx.log('petdex.pets: could not warm the catalogue —', err);
    }
  });

  void Promise.all([
    storage.get('pet'),
    storage.get('hidden'),
    storage.get(REVERSED_PETS_KEY),
  ])
    .then(([saved, hidden, reversed]) => {
      if (typeof saved === 'string' && saved) active = saved;
      if (Array.isArray(reversed)) {
        reversedPets = new Set(reversed.filter(slug => typeof slug === 'string'));
      }
      if (!hidden) showOverlay(true);
    })
    .catch(err => {
      ctx.log('petdex.pets: could not read prefs —', err);
      showOverlay(true);
    });
}

export function deactivate() {
  subscribers.clear();
  document.getElementById('petdex-pets-style')?.remove();
}
