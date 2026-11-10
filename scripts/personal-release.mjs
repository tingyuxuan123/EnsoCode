import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { assertReleaseVersion, verifyReleaseDirectory } from './release.mjs';

const releaseNotesDirectory = fileURLToPath(new URL('../release-notes/', import.meta.url));
const MAX_RELEASE_NOTES_BYTES = 24 * 1024;

/** One immutable, version-bound source for the GitHub release body and the personal feed. */
export async function readPersonalReleaseNotes(version, notesDirectory = releaseNotesDirectory) {
  assertReleaseVersion(version);
  const directory = path.resolve(notesDirectory);
  const filename = path.join(directory, `${version}.md`);
  if (!(await lstat(directory)).isDirectory() || !(await lstat(filename)).isFile()) {
    throw new Error('Personal release notes must be a regular file in the release-notes directory');
  }
  const file = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_RELEASE_NOTES_BYTES) {
      throw new Error('Personal release notes must be a regular file of at most 24 KiB');
    }
    const data = Buffer.alloc(MAX_RELEASE_NOTES_BYTES + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_RELEASE_NOTES_BYTES) throw new Error('Personal release notes exceed 24 KiB');
    const content = new TextDecoder('utf-8', { fatal: true })
      .decode(data.subarray(0, offset))
      .replace(/\r\n?/g, '\n')
      .trimEnd();
    const heading = `# 小满 ${version}`;
    // 已发布的历史日志保留原文；重新读取时统一显示新品牌，不改变版本/正文校验。
    const sourceHeading = [heading, `# EnsoCode ${version}`].find((candidate) =>
      content.startsWith(`${candidate}\n`)
    );
    if (!sourceHeading || !content.slice(sourceHeading.length).trim()) {
      throw new Error(`Personal release notes require '${heading}' and a non-empty body`);
    }
    return `${heading}${content.slice(sourceHeading.length)}\n\n---\n\n个人测试通道 ${version}：仅供信任 EnsoCode Local Signing 证书的 Mac arm64 使用。不是正式发布（latest），未公证。安装与重启由用户操作。\n`;
  } finally {
    await file.close();
  }
}

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
export async function preparePersonalFeed(artifactDir, outputDir, version, notesDirectory) {
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
    releaseName: `小满 ${version} — 个人测试`,
    releaseNotes: await readPersonalReleaseNotes(version, notesDirectory),
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'latest-mac.yml'), stringify(feed));
  return feed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [artifactDir, outputDir, ...extra] = process.argv.slice(2);
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  try {
    if (artifactDir === 'notes' && !outputDir) {
      process.stdout.write(await readPersonalReleaseNotes(version));
    } else if (artifactDir && outputDir && extra.length === 0) {
      await preparePersonalFeed(artifactDir, outputDir, version);
    } else {
      throw new Error(
        'Usage: personal-release.mjs notes | <verified-artifact-dir> <feed-output-dir>'
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
