import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

export function assertReleaseVersion(version, tag) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Release version must be a stable semantic version');
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Tag ${tag} does not match package version ${version}`);
  }
  return version;
}

function validateManifest(value, version) {
  assertReleaseVersion(version);
  if (value?.version !== version || !Array.isArray(value.files) || !value.files.length) {
    throw new Error('Missing files or mismatched update manifest version');
  }
  const seen = new Set();
  for (const file of value.files) {
    if (
      typeof file?.url !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file.url) ||
      !new RegExp(`[-_]${version.replaceAll('.', '\\.')}[-_.]`).test(file.url) ||
      seen.has(file.url) ||
      typeof file.sha512 !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
      Buffer.from(file.sha512, 'base64').toString('base64') !== file.sha512 ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0
    ) {
      throw new Error('Invalid, unsafe or duplicate update file');
    }
    seen.add(file.url);
  }
  return value;
}

export function mergeMacManifests(arm, intel, version) {
  validateManifest(arm, version);
  validateManifest(intel, version);
  if (
    !arm.files.some((file) => file.url.includes('-arm64') && file.url.endsWith('.zip')) ||
    !intel.files.some((file) => !file.url.includes('-arm64') && file.url.endsWith('.zip'))
  ) {
    throw new Error('Both arm64 and x64 Mac ZIP installers are required');
  }
  return validateManifest({ ...arm, files: [...arm.files, ...intel.files] }, version);
}

async function digest(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

/** Verify actual installer bytes, not just the presence of YAML entries. Never download here. */
export async function verifyReleaseDirectory(dir, version, { allPlatforms = false } = {}) {
  assertReleaseVersion(version);
  const names = await readdir(dir);
  const manifests = names.filter((name) => /^latest(?:-mac|-linux)?\.yml$/.test(name));
  if (
    !manifests.length ||
    (allPlatforms &&
      ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'].some((name) => !names.includes(name)))
  ) {
    throw new Error('Required platform update manifests are missing');
  }
  for (const name of manifests) {
    const manifest = validateManifest(parse(await readFile(path.join(dir, name), 'utf8')), version);
    if (allPlatforms && name === 'latest-mac.yml') {
      if (
        !manifest.files.some((file) => file.url.includes('-arm64') && file.url.endsWith('.zip')) ||
        !manifest.files.some((file) => !file.url.includes('-arm64') && file.url.endsWith('.zip'))
      )
        throw new Error('Merged Mac manifest must contain both ZIP architectures');
    }
    for (const file of manifest.files) {
      const target = path.join(dir, file.url);
      const stat = await lstat(target);
      if (
        !stat.isFile() ||
        stat.size !== file.size ||
        (await digest(target, 'sha512', 'base64')) !== file.sha512
      ) {
        throw new Error(`Installer size or SHA-512 mismatch: ${file.url}`);
      }
    }
  }
  const sums = [];
  for (const name of names.sort()) {
    if (name === 'SHA256SUMS') continue;
    const file = path.join(dir, name);
    if (!(await lstat(file)).isFile()) continue;
    if (/[\r\n\\]/.test(name)) throw new Error('Unsafe checksum filename');
    sums.push(`${await digest(file, 'sha256', 'hex')}  ${name}`);
  }
  await writeFile(path.join(dir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  return sums;
}

async function main() {
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  const [command, ...args] = process.argv.slice(2);
  if (command === 'version') {
    const tag = process.env.GITHUB_REF?.startsWith('refs/tags/')
      ? process.env.GITHUB_REF.slice(10)
      : undefined;
    console.log(assertReleaseVersion(version, tag));
  } else if (command === 'merge-mac' && args.length === 3) {
    const inputs = await Promise.all(
      args.slice(0, 2).map(async (file) => parse(await readFile(file, 'utf8')))
    );
    await writeFile(args[2], stringify(mergeMacManifests(inputs[0], inputs[1], version)));
  } else if (command === 'verify' && args[0]) {
    await verifyReleaseDirectory(args[0], version, {
      allPlatforms: args.includes('--all-platforms'),
    });
    console.log(`Verified release ${version}: ${args[0]}`);
  } else {
    throw new Error(
      'Usage: release.mjs version | merge-mac <arm.yml> <x64.yml> <output> | verify <dir> [--all-platforms]'
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
