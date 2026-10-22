import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { assertReleaseVersion, verifyReleaseDirectory } from './release.mjs';

/** A delayed tag build must never downgrade or replace the current personal feed. */
export function assertPersonalFeedAdvance(current, next) {
  assertReleaseVersion(current);
  assertReleaseVersion(next);
  const left = current.split('.').map(BigInt);
  const right = next.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (right[i] > left[i]) return;
    if (right[i] < left[i]) break;
  }
  throw new Error('Personal update feed must advance to a newer version');
}

/** Convert only verified local manifests; never weaken the official release URL validator. */
export async function preparePersonalFeed(artifactDir, outputDir, version) {
  assertReleaseVersion(version);
  await verifyReleaseDirectory(artifactDir, version);
  const manifest = parse(await readFile(path.join(artifactDir, 'latest-mac.yml'), 'utf8'));
  if (!manifest.files.some((file) => file.url.endsWith('-arm64-mac.zip'))) {
    throw new Error('Personal feed requires an arm64 Mac ZIP');
  }
  const base = `https://github.com/tingyuxuan123/EnsoCode/releases/download/personal-v${version}/`;
  const files = manifest.files.map((file) => ({ ...file, url: new URL(file.url, base).href }));
  const zip = files.find((file) => file.url.endsWith('-arm64-mac.zip'));
  const feed = {
    version,
    files,
    path: zip.url,
    sha512: zip.sha512,
    releaseDate: manifest.releaseDate,
    releaseName: `EnsoCode ${version} — 个人测试`,
    releaseNotes: `个人测试通道 ${version}：仅供信任 EnsoCode Local Signing 证书的 Mac 使用。不是正式发布。`,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'latest-mac.yml'), stringify(feed));
  return feed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [artifactDir, outputDir] = process.argv.slice(2);
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  if (!artifactDir || !outputDir) {
    console.error('Usage: personal-release.mjs <verified-artifact-dir> <feed-output-dir>');
    process.exitCode = 1;
  } else {
    preparePersonalFeed(artifactDir, outputDir, version).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
