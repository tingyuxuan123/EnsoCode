# Open Vetta design resources

- Source: Open Vetta, `packages/plugins/presets/vetta-ui-design` from the supplied
  `open-vetta-main` source snapshot (no Git commit metadata was present).
- Plugin `package.json`: **0.1.15**; `plugin.json`: **0.7.6**.
- License: Apache-2.0, copyright **2026 Vetta**. Original repository `LICENSE`
  and `NOTICE` are preserved alongside this file. Only the design subsystem is
  ported; upstream's sandbox binaries, model weights and portable runtimes are not.
- `engine/{index.html,vite.config.mjs,package.json,package-lock.json,src/**}`,
  `skills/vetta-ui-design/**`, and `agents/{designer.md,designer.webp}` are
  copied without source changes. Engine package version: **0.1.0**.

## Relocation checks

`engine/vite.config.mjs` has no monorepo-relative dependency: `@vetta/ios`
resolves to `engine/src/ios/StatusBar.tsx`, and all dependency aliases resolve
under the engine's own `node_modules`. `VETD_SRC` is an intentional runtime
input, not an upstream build path: Main must set it to the authoritative design
directory and start Vite with the materialized engine directory as `cwd`.
Without it, upstream falls back to `cwd/design`. No config patch was needed.

The skill's `references/**` layout is unchanged. Its executable instruction
references resolve within the skill directory; `references/taste/UPSTREAM.md`
also mentions upstream taste-skill paths for attribution, not runtime reading.
That directory retains the full Hallmark MIT license.

Do **not** duplicate `vendor/taste-skill` into these resources. Upstream
`src/direction/library.ts` imports `directions`, `heroes`, `sections`, `type` and
`palettes` JSON, and `src/assets/assets-tool.ts` imports `photos.json` for the
renderer bundle. The renderer port owns that vendored source directory, its
MIT `LICENSE` and its `UPSTREAM.md` (taste-skill 2.1.5, commit
`12af471f627f866411b4bd785b19646d3672784c`). `THIRD_PARTY_NOTICES.md` covers both
the source adaptations and direction/photo data.

## History runner: rebuilding the vendored artifact

`history-runner/runner.mjs` is a self-contained ESM bundle of the unmodified
upstream `history-runner/src/runner-entry.ts`, built with upstream's
`vite.runner.config.ts` (Node 20 target), with **one build-only change**:
`minify: true` → `minify: false`. This preserves readable identifiers and allows
users to modify/replace the LGPL-covered helper below. Only Node built-ins remain external.
There is no runtime npm install. The dependency versions used were:

- Vite **7.1.7** (build tool)
- isomorphic-git **1.41.3**
- fflate **0.8.2**

Rebuild without altering the upstream checkout or installing its workspace SDK:

```bash
P=/path/to/open-vetta-main/packages/plugins/presets/vetta-ui-design
REPO=/path/to/EnsoCode
TMP=$(mktemp -d /tmp/enso-design-runner.XXXXXX)
cp -R "$P" "$TMP/plugin"
cp "$REPO/resources/design/history-runner/source/vite.runner.config.ts" "$TMP/plugin/"
mkdir -p "$TMP/build-tools"
cp "$REPO/resources/design/history-runner/source/build-tools.package.json" "$TMP/build-tools/package.json"
cp "$REPO/resources/design/history-runner/source/build-tools.package-lock.json" "$TMP/build-tools/package-lock.json"
npm ci --prefix "$TMP/build-tools" --no-audit --no-fund
ln -s ../build-tools/node_modules "$TMP/plugin/node_modules"
(cd "$TMP/plugin" && ../build-tools/node_modules/.bin/vite build --config vite.runner.config.ts)
cp "$TMP/plugin/history-runner/dist/runner.mjs" "$REPO/resources/design/history-runner/runner.mjs"
```

This snapshot built to 566.88 kB (gzip 120.40 kB), SHA-256
`cdf461f9c6b47c6170220a12fde7649a851844445d5cceb5e34ae959dfe68b0d`.
The build-tools lock pins transitive dependencies. Review any resulting diff and
repeat smoke checks before replacing the artifact. A self-contained rebuild can
also use `history-runner/source/runner-entry.ts` and the included config in the
same `history-runner/src/` layout, without the original plugin checkout.

Smoke from a temporary design directory containing at least one source file:

```bash
ELECTRON_RUN_AS_NODE=1 /path/to/Electron \
  resources/design/history-runner/runner.mjs \
  '{"cmd":"init","dir":"/tmp/example.vetd"}'
# Repeat with {"cmd":"commit","dir":"/tmp/example.vetd","title":"Smoke test"}
# and {"cmd":"log","dir":"/tmp/example.vetd","limit":10}.
```

Verified with this repository's Electron-as-Node: init returned
`ok:true, initialized:true, hasCommits:false`, commit returned
`ok:true, committed:true`, log returned that same SHA and changed-file list.

### LGPL-covered path helper (separate from Apache/MIT)

isomorphic-git **1.41.3** (`gitHead`
`aa6812cd674bf2f9d4cd3c9ad7bcaf608ce80b90`) includes a copy of ZenFS's path helper
under **LGPL-3.0-or-later**, copyright **James Prevett and other ZenFS contributors**.
The package-level MIT license does not supersede that explicit file notice.

- Original isomorphic-git source: `src/utils/join.js`; npm package entry:
  `index.js` (and `index.cjs`). The source-map `sourcesContent` supplies the
  uncombined preferred source copied verbatim as
  `history-runner/source/isomorphic-git-join.js` (lines **1–147**).
- Bundled location: `history-runner/runner.mjs` lines **8916–9025**, comprising
  the original license notice and `normalizeString`, `getWindowsDrivePrefix`,
  `normalize`, and `join`. No EnsoCode semantic changes were made to this helper.
- ZenFS source: <https://github.com/zen-fs/core/blob/main/src/path.ts>, published
  as `@zenfs/core/path`. Its precise source commit is **not identified** by the
  isomorphic-git notice; do not infer a ZenFS version from its devDependency range.
- Obtain full isomorphic-git source with
  `git clone https://github.com/isomorphic-git/isomorphic-git.git`, then
  `git checkout aa6812cd674bf2f9d4cd3c9ad7bcaf608ce80b90`.
  The npm distribution is available with `npm pack isomorphic-git@1.41.3`.
  fflate source: <https://github.com/101arrowz/fflate> (npm `fflate@0.8.2`).

`history-runner/LICENSES/` contains isomorphic-git's MIT license, fflate's MIT
license, and the complete LGPL-3.0 and referenced GPL-3.0 texts from gnu.org.
The LGPL portion is not relicensed as Apache or MIT. You may modify that portion
and reverse-engineer for debugging those modifications under its license.
The standalone readable `runner.mjs` is outside asar; replace its helper in
place, or modify the helper in the build-tools `node_modules/isomorphic-git/index.js`
and rebuild using the supplied inputs. No source hash/obfuscation check prevents
replacement. Modifying a signed installed app can invalidate its macOS signature;
for local execution use the modified standalone runner with Electron-as-Node
(or rebuild/re-sign your own application), not the updater's signed distribution.

## Preinstalled engine and packaging

Run `node scripts/prepare-design-engine.mjs`. It runs
`npm ci --no-audit --no-fund --include=dev` with explicit target OS/CPU, and
skips only when `node_modules` exists and the lock SHA-256 + target stamp match.
The stamp and installed modules are ignored by Git. Failure removes the stamp
and exits nonzero. Set `npm_config_arch` for cross-architecture builds; these
use `--ignore-scripts` to avoid esbuild's host-architecture postinstall probe.
The target-specific optional package is sufficient for its runtime launcher.
CI prepares separately on each packaging platform; it does not reuse Linux
`node_modules` in Mac packages. Locally measured darwin-arm64 install: **130M**
(`du -sh`); Electron-as-Node reports `vite/7.3.6 darwin-arm64`.

Both builder configurations copy this directory to `Resources/design` via
`extraResources`, outside asar, with their own filter (not the application
`files` exclusions). Keep runtime JS, CSS, package metadata, esbuild binaries
and `.node` files intact. Caches and the local preparation stamp are excluded.
`scripts/after-pack.mjs` removes foreign OS/CPU optional packages using package
metadata, including nested dependencies, then the existing Mach-O architecture
gate runs. Universal `fsevents.node` is retained because it includes arm64.

Signing behavior was checked against installed electron-builder **26.15.3**:
`app-builder-lib/out/mac/MacTargetHelper.js` delegates to `@electron/osx-sign`
**1.3.3**, whose `signApplication` walks the entire app `Contents`, including
`Resources/design`, with `walkAsync` binary detection. Thus esbuild, Rollup,
lightningcss, Tailwind oxide and fsevents are automatically signed with inherited
entitlements; no `mac.binaries` list or signing bypass is needed. Pruning happens
in afterPack, before signing. The existing CI deep/strict signature gates remain
mandatory. Actual signed packaging/notarization was **not** run locally: personal
CI intentionally does not notarize; Developer ID notarization and cross-platform
execution remain CI acceptance items, not proven by the local arm64 smoke.
