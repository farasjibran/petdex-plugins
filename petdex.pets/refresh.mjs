/* Regenerate pets.json — the bundled petdex snapshot.
 *
 *   node plugins/petdex.pets/refresh.mjs
 *
 * Why this exists: install and love counts only exist behind
 * https://petdex.dev/api/pets/search, and that endpoint sends no
 * `access-control-allow-origin`, so the plugin's webview cannot read it. The
 * CORS-enabled manifest (api/manifest/v2) carries slug, name, kind, maker and
 * the spritesheet — but no counts, and no description, tags or vibes to search.
 *
 * So we snapshot the counts and the search text once, here, and the picker
 * runs against the file. Counts go stale between runs; they are counters, not
 * catalogue facts, and the manifest still drives which pets exist and where
 * their sprites live.
 *
 * Rows are positional (see `fields`) rather than objects: ~30% smaller, and
 * 4,874 repeated key names are not something to ship.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://petdex.dev/api/pets/search';
const LIMIT = 60;            // the API caps a page at 60
const FIELDS = ['slug', 'installs', 'loves', 'description', 'vibes', 'tags', 'approved'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPage(cursor) {
  const query = new URLSearchParams({ limit: String(LIMIT), includeMeta: '0', sort: 'installed' });
  if (cursor) query.set('cursor', String(cursor));
  const url = `${API}?${query}`;
  /* a 5xx or a dropped connection is worth another try; a 404 is not */
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw err;
      console.error(`  retry ${attempt + 1}: ${err.message}`);
      await sleep(600 * (attempt + 1));
    }
  }
}

const rows = [];
let cursor = 0;
let expected = 0;

for (;;) {
  const page = await fetchPage(cursor);
  expected = page.total ?? expected;
  for (const pet of page.pets) {
    rows.push([
      pet.slug,
      pet.metrics?.installCount ?? 0,
      pet.metrics?.likeCount ?? 0,
      pet.description || '',
      pet.vibes || [],
      pet.tags || [],
      (pet.approvedAt || '').slice(0, 10),
    ]);
  }
  console.error(`${rows.length}/${expected || '?'}`);
  if (!page.nextCursor || (expected && page.nextCursor >= expected)) break;
  cursor = page.nextCursor;
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: `${API}?sort=installed`,
  fields: FIELDS,
  pets: rows,
};

const out = fileURLToPath(new URL('./pets.json', import.meta.url));
writeFileSync(out, JSON.stringify(snapshot));
console.error(`wrote ${out}: ${rows.length} pets, ${JSON.stringify(snapshot).length} bytes`);