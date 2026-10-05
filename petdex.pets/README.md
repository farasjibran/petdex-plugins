# Petdex Pets

> **Install:** Settings → Plugins → Browse marketplace… → Petdex Pets → Install.
> Lives in [`farasjibran/petdex-plugins`](https://github.com/farasjibran/petdex-plugins),
> which carries the `bentomux-plugin` topic.

A draggable pet that floats over Bentomux and reacts to the agent in the
terminal you are actually looking at: a working pane makes it run, a blocked
one makes it wait, and an unresolved approval makes it wait in any pane,
because Bentomux's own prompt does too.

| Where | What |
|---|---|
| Everywhere | The pet, fixed to the window, draggable, corner remembered. No text on hover or drag — the pet is the whole thing |
| Settings → *Petdex* | Search and pick a pet. The section is listed only while the plugin is active |
| `Cmd+K` → *Petdex: Toggle the pet* | Show or hide the floating pet |
| Picker cards | Every thumbnail animates its idle loop; each card names the maker and its installs and loves; the selected one is green with a check |
| Picker controls | Kind chips (with live facet counts) and a sort: most installed, most loved, newest, A to Z |
| Picker arrows | `←` `→` `↑` `↓` walk the grid, `Home` / `End` jump, `Esc` returns to the search box, `Enter` applies |

The picker is a settings section rather than a topbar button or a tab. It is a
place you visit to choose something once, not a destination you keep open, and
the host drops a section's DOM on every switch without calling a cleanup — so
each build retires the one before it instead of leaving a debounce timer and
in-flight image probes writing into a detached tree.

Green is a literal pair, `#1a7f37` light and `#7ee787` dark, matching the diff
page's addition tint. There is no `--ok` token in the palette and no palette
ships one that stays readable against every `--bg`.

The sort dropdown is not styled here. It carries the host's own
`select-input` class, so it gets the app's chevron, hover and focus ring — and
its one plugin rule is the width, because the host's `width:100%` belongs in a
form field and would eat the search box in a flex bar. Anything else the host
changes about selects arrives here for free.

## Tests

```bash
node plugins/petdex.pets.test.mjs        # atlas maths and the pane-state map
node plugins/petdex.pets.dom.test.mjs    # picker behaviour, against a fake DOM
```

The second one exists because the picker is where the real branching is —
paging, debouncing, a roving tab stop, an image fallback, section re-entry, and
now the search, sort and facet paths. It drives the actual plugin entry through
a ~150-line fake DOM, including the throw-away-and-rebuild the settings host
does on every switch. It is not a general-purpose shim; it implements the
handful of selectors and layout facts this plugin uses.

Its fake `fetch` answers both requests the plugin makes — the remote manifest
and the bundled `pets.json` — and `pets.json` is served in the real positional
row shape, so a column reorder in `refresh.mjs` fails these checks instead of
silently showing wrong counts.

| File | Purpose |
|---|---|
| `plugin.json` | Manifest: identity, permissions, contributions. |
| `index.js` | Entry — `activate(ctx)`, the overlay, the picker section. |
| `sprite.js` | Atlas geometry and the pane-state → pet-state mapping. |
| `pets.json` | Generated snapshot: installs, loves, description, tags, vibes. `node refresh.mjs` regenerates it. |
| `refresh.mjs` | Pages `petdex.dev/api/pets/search` and writes `pets.json`. |
| `bentomux-plugin-sdk.d.ts` | Types for the context API. |

## One keyframes rule

Every sprite — the floating pet and all 48 picker cards — shares a single
`@keyframes` and supplies its geometry through custom properties
(`--pdx-url`, `--pdx-w`, `--pdx-y`, `--pdx-end`, `--pdx-ms`, `--pdx-frames`).
Adding a pet costs no new CSS, and the illegal-identifier class of bug cannot
recur because no name is built per pet.

`--pdx-end` is `frames * cell width`, **not** `(frames - 1) * cell`. `steps(N)`
samples a range at `0, 1/N, …, (N-1)/N`, so ending on the last frame puts
every sample between cells and the sprite smears sideways instead of stepping.

## Paging and focus

The grid pages by appending, never by redrawing. A redraw would rebuild the 48
cards already on screen, restart each one's idle loop at frame zero and re-probe
every image the user has already seen. Search is debounced 120 ms for the same
reason: filtering 4,871 rows is instant, but each redraw builds up to 48 cards
and probes 48 images.

The grid is a single tab stop. Arrows move focus, and the roving `tabindex`
travels with it — including on the `focus` event, which is what keeps `Tab`
working once you have arrowed into the grid.

Busy rings go on the manifest, on a thumbnail that has not decoded, and on the
overlay while it fetches a 1–2 MB sheet. A ring is a claim that something is in
flight, so it never goes on a card whose picture is already there, and it is
always cleared — including when a pet has neither a preview nor a sheet.

## Where the counts come from

Cards show `by <maker>`, `↓ installs` and `♥ loves`. The maker is free — the
CORS-enabled manifest already carries `submittedBy`. The counts are not.

Counts live only on `https://petdex.dev/api/pets/search`
(`metrics.installCount`, `metrics.likeCount`), and that endpoint sends no
`access-control-allow-origin`, so a plugin webview cannot read it. The manifest
sends `*`, which is why the plugin can fetch it and the search API not.

So `refresh.mjs` pages the search API once and writes `pets.json` — positional
rows of `[slug, installs, loves, description, vibes, tags, approvedAt]`, about
1.0 MB raw and 400 KB gzipped. The folder stays well under the 5 MB plugin cap.
Counts are counters, so going stale between runs costs little, and the manifest
still decides which pets exist and where their sprites live. A missing
`pets.json` is not fatal: the picker falls back to the manifest alone and the
cards simply show no counts, rather than a fake `0`.

The snapshot is also what makes the search good: description, tags and vibes
are in it and in nowhere else.

## Search, the way petdex.dev does it

`petdex.dev`'s `q` is a keyword **AND** over name, slug, description, tags and
vibes — `cozy night programmer` finds pets that are all three. This does the
same, and adds the maker name, which petdex deliberately leaves unindexed (a
search for `railly` returns nothing there and returns railly's pets here).

Each pet gets one lowercase haystack at load, so a keystroke is one `includes`
per token over 4.8k rows. Hits are ranked — an exact name beats a name prefix
beats a name substring beats a mention in the description — and the chosen sort
breaks the rest.

`sort=curated` is the one petdex sort with no equivalent here: it is a shuffled
selection, not an order, and the API hands back the seed it used.

## How the state reaches the pet

`ctx.events.on('tab:activated')` reports `{ tabId, paneId }`; `paneId` is the
focused pane, and it fires again a moment after a tab switch, once xterm takes
focus. `ctx.app.onRuntimeStatus` carries one entry per pane. Only the focused
pane's entry decides the mood, so a background tab churning through a build does
not make the pet in front of you look busy.

Pets come from the public `https://petdex.dev/api/manifest/v2` manifest and
`assets.petdex.dev`; no sprite is bundled. The picker is ~4.8k rows, past the
1 MB storage cap, so it stays in memory and only the chosen slug and the pet's
corner are persisted.

Picker cards animate from `preview.webp` — one row cut out of the atlas, 6
frames of 192×208 — so a card animates from the ~40 KB image it was already
fetching rather than the multi-megabyte sheet. A missing preview (petdex #579)
falls back to cropping the sheet's idle row instead.

Nothing about the sheet is hardcoded, because the upstream data is not
trustworthy. The manifest's `spriteVersionNumber` disagrees with the real image
on roughly one pet in five — 14 of 70 sampled atlases declare v1 while shipping
a 1536×2288 11-row sheet — and believing it makes the cell 11% too tall, so
every row is drawn stretched and shifted and the pet reads as cropped. The row
count and the preview frame count are therefore both derived from the image's
own pixel dimensions (`rowsForSheet`, `stripFrames`), and the cell is snapped to
whole pixels so the browser resamples the sheet to an exact integer size instead
of rounding each texel and drifting the frame edge.

Check and validate, from the `petdex-plugins` repo root:

    node --test petdex.pets.test.mjs petdex.pets.dom.test.mjs
    node petdex.pets/refresh.mjs   # only when petdex counts moved
    bentomux --plugin-validate petdex.pets

Or from a Bentomux checkout, which symlinks this folder into its gitignored
`plugins/` working-copy area:

    node --test plugins/petdex.pets.test.mjs plugins/petdex.pets.dom.test.mjs
    bentomux --plugin-validate plugins/petdex.pets

Publish a release with `./publish.sh <version>` from the repo root.

## Limits

The pet is a `position: fixed` element inside the main window, so it is clipped
to it and cannot float over other applications — a real always-on-top OS window
would be host work (a Rust command plus a new permission), which plugins cannot
add.
