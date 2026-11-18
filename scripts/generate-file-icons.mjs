#!/usr/bin/env node
// Bundles the Material Icon Theme (https://github.com/material-extensions/
// vscode-material-icon-theme, the icon theme of material-icons-browser-extension)
// for the file tree, search hits, file tabs and artifact cards.
//
//   npm pack material-icon-theme@5.40.0 && tar xzf material-icon-theme-*.tgz
//   node scripts/generate-file-icons.mjs package src/renderer/assets/file-icons
//
// Writes manifest.json (the theme's default icons plus its name / extension /
// folder mappings by icon id), icons/<id>.svg for every icon those mappings
// reach, and the theme's LICENSE. Only the default theme is bundled; the light
// and high-contrast variants are dropped.
//
// Two shape reductions keep the manifest small enough to import from the
// renderer, and both are re-checked here so an upstream change fails loudly
// instead of producing a silently different icon set:
//   - mapping keys are lowercased (the renderer matches lowercase basenames);
//   - `folderNamesExpanded` / `folderExpanded` / `rootFolderExpanded` are not
//     stored, because the theme spells every open variant `<closed>-open`.

import fs from 'node:fs';
import path from 'node:path';

const [source, output] = process.argv.slice(2);
if (!source || !output) {
  console.error('usage: generate-file-icons.mjs <material-icon-theme-package-dir> <output-dir>');
  process.exit(64);
}

const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const theme = JSON.parse(fs.readFileSync(path.join(source, 'dist', 'material-icons.json'), 'utf8'));

const lower = (map, label) =>
  Object.fromEntries(
    Object.entries(map ?? {}).map(([key, id]) => {
      const name = key.toLowerCase();
      if (name !== key && Object.hasOwn(map, name) && map[name] !== id) {
        throw new Error(`${label}: "${key}" collides with "${name}" after lowercasing`);
      }
      return [name, id];
    })
  );

const sorted = (map) =>
  Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function assertOpenVariants(closed, open, label) {
  const closedKeys = Object.keys(closed).sort();
  const openKeys = Object.keys(open ?? {}).sort();
  if (closedKeys.join('\0') !== openKeys.join('\0')) {
    throw new Error(`${label}: closed and open mappings do not cover the same names`);
  }
  for (const key of closedKeys) {
    if (open[key] !== `${closed[key]}-open`) {
      throw new Error(`${label}: "${key}" opens as ${open[key]}, expected ${closed[key]}-open`);
    }
  }
}

const folderNames = lower(theme.folderNames, 'folderNames');
assertOpenVariants(folderNames, lower(theme.folderNamesExpanded, 'folderNamesExpanded'), 'folders');
if (theme.folderExpanded !== `${theme.folder}-open`) {
  throw new Error(`default folder opens as ${theme.folderExpanded}, expected ${theme.folder}-open`);
}
if (theme.rootFolderExpanded !== `${theme.rootFolder}-open`) {
  throw new Error(
    `root folder opens as ${theme.rootFolderExpanded}, expected ${theme.rootFolder}-open`
  );
}

const manifest = {
  name: pkg.name,
  version: pkg.version,
  file: theme.file,
  folder: theme.folder,
  rootFolder: theme.rootFolder,
  fileNames: sorted(lower(theme.fileNames, 'fileNames')),
  fileExtensions: sorted(lower(theme.fileExtensions, 'fileExtensions')),
  folderNames: sorted(folderNames),
};

const used = new Set([
  manifest.file,
  `${manifest.folder}-open`,
  manifest.folder,
  `${manifest.rootFolder}-open`,
  manifest.rootFolder,
  ...Object.values(manifest.fileNames),
  ...Object.values(manifest.fileExtensions),
  ...Object.values(manifest.folderNames).flatMap((id) => [id, `${id}-open`]),
]);

const icons = path.join(output, 'icons');
fs.rmSync(icons, { recursive: true, force: true });
fs.mkdirSync(icons, { recursive: true });
let bytes = 0;
for (const id of [...used].sort()) {
  const definition = theme.iconDefinitions[id];
  if (!definition) throw new Error(`No icon definition for ${id}`);
  const file = path.join(source, 'dist', definition.iconPath);
  // Whitespace between tags only: the drawing itself is untouched.
  const svg = fs.readFileSync(file, 'utf8').replace(/>\s+</g, '><').trim();
  fs.writeFileSync(path.join(icons, `${id}.svg`), svg);
  bytes += svg.length;
}
// One line: generated data, and the renderer bundle only keeps the parsed copy.
fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(output, 'LICENSE'));
console.log(
  `${pkg.name}@${pkg.version}: ${used.size} icons, ${(bytes / 1024).toFixed(0)} KiB, manifest ${(
    JSON.stringify(manifest).length / 1024
  ).toFixed(0)} KiB`
);
