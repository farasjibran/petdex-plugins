# Petdex Plugins

Plugins for [Bentomux](https://github.com/takora-dev/bentomux), a desktop app
for managing AI agent runtime workspaces.

This repo is the marketplace source. It is discovered by the
`bentomux-plugin` GitHub topic, and each plugin's **latest release** is what
Bentomux installs. There is no registration step — the topic *is* the
registration.

## Plugins

| Plugin | Install | Description |
|---|---|---|
| **Petdex Pets** `petdex.pets` | Settings → Plugins → Browse marketplace… → Install | A draggable pet that floats over Bentomux and reacts to the agent in the terminal you are looking at |

Each plugin lives in its own folder named after its plugin id
(`petdex.pets/`), which is the convention the platform spec sets. Its full
README — dev notes, limits, sprite-sheet details — is in that folder.

## Working on a plugin

```bash
git clone git@github.com:farasjibran/petdex-plugins.git
cd petdex-plugins

node --test petdex.pets.test.mjs petdex.pets.dom.test.mjs   # plugin tests
node petdex.pets/refresh.mjs                                # only when petdex counts moved
```

Validate against a real Bentomux:

```bash
bentomux --plugin-validate petdex.pets
```

Exit `0` is ok, `1` means errors were found, `2` is a usage error.

Install it into the app during development:

```bash
cd /path/to/Bentomux-v2
./src-tauri/target/debug/bentomux --plugin-validate plugins/petdex.pets
# then Settings → Plugins → Install plugin… → "A folder on this computer"
```

## Publishing a release

```bash
./publish.sh 1.6.1
```

That script validates, refuses a version that disagrees with `plugin.json`,
zips, and creates the GitHub release. Read
[`publish.sh`](./publish.sh) before running it — it is short.

Three rules the marketplace depends on:

1. **The tag and `plugin.json`'s `version` must agree.** The marketplace
   compares the release tag against the installed manifest version to offer an
   update, stripping one leading `v`. `v1.6.1` + `"version": "1.6.1"`. A tag
   like `nightly` or `release-3` is not a version and gets no update offered.
2. **Exactly one `.zip` asset per release.** Zero is not installable; two is
   ambiguous and refused.
3. **The plugin files sit at the archive root** — `plugin.json`, `index.js`,
   assets. No wrapper directory.

You do not compute a digest: GitHub publishes a sha256 for every release asset
and Bentomux enforces it on download. That is why a release is required — a
GitHub-generated source tarball has no published checksum, so there is nothing
to verify it against.

Full rules, including what the app trusts about a catalog row:
[`docs/PLUGIN_MARKETPLACE.md`](https://github.com/takora-dev/bentomux/blob/master/docs/PLUGIN_MARKETPLACE.md).

## Adding a plugin

Ask your Bentomux agent to build it — Plugin Studio → **Install authoring
skill…** installs the `bentomux-plugin-author` skill, then say *"implement this
plugin using the bentomux-plugin-author skill"*. Or copy a template:

```bash
cp -r /path/to/Bentomux-v2/resources/plugin-templates/basic acme.habit-tracker
```

The folder name must equal the plugin id (`publisher.name`, both segments
`[a-z0-9-]+`), and `bentomux` is reserved for plugins bundled in the app.