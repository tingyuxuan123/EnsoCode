import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { assertReleaseVersion, mergeMacManifests, verifyReleaseDirectory } from './release.mjs';

const version = '0.2.10';
const data = Buffer.from('test installer');
const sha512 = createHash('sha512').update(data).digest('base64');
const manifest = (url) => ({ version, files: [{ url, sha512, size: data.length }] });
const arm = manifest(`EnsoCode-${version}-arm64-mac.zip`);
const intel = manifest(`EnsoCode-${version}-mac.zip`);

test('版本与 tag 必须一致，手动分支构建也必须使用合法稳定版本', () => {
  assert.equal(assertReleaseVersion(version, `v${version}`), version);
  assert.equal(assertReleaseVersion(version), version);
  for (const bad of ['latest', '01.2.3', '1.2', '1.2.3;echo bad']) {
    assert.throws(() => assertReleaseVersion(bad));
  }
  assert.throws(() => assertReleaseVersion(version, 'v0.2.9'));
  assert.throws(() => assertReleaseVersion(version, version));
});

test('Mac 合并同时保留两架构 zip 的哈希、大小和兼容旧字段', () => {
  const result = mergeMacManifests({ ...arm, path: arm.files[0].url, sha512 }, intel, version);
  assert.deepEqual(result.files, [...arm.files, ...intel.files]);
  assert.equal(result.path, arm.files[0].url);
  assert.equal(result.sha512, sha512);
  assert.equal(arm.files.length, 1);
});

test('Mac 合并拒绝错版本、缺架构、重复文件和不可信下载地址', () => {
  for (const bad of [
    { ...intel, version: '0.2.9' },
    arm,
    { ...intel, files: [] },
    manifest('../outside.zip'),
    manifest('https://evil.example/installer.zip'),
    manifest('dir%2Finstaller.zip'),
    { ...intel, files: [{ ...intel.files[0], sha512: 'bad' }] },
    { ...intel, files: [{ ...intel.files[0], size: -1 }] },
  ]) {
    assert.throws(() => mergeMacManifests(arm, bad, version));
  }
});

test('真实产物按清单校验后输出 SHA256SUMS，缺包、坏包不放行', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-release-'));
  try {
    await writeFile(path.join(dir, 'latest-mac.yml'), stringify(arm));
    await assert.rejects(verifyReleaseDirectory(dir, version));
    await writeFile(path.join(dir, arm.files[0].url), data);
    await verifyReleaseDirectory(dir, version);
    const sums = await readFile(path.join(dir, 'SHA256SUMS'), 'utf8');
    assert.ok(
      sums.includes(`${createHash('sha256').update(data).digest('hex')}  ${arm.files[0].url}`)
    );
    await writeFile(path.join(dir, arm.files[0].url), Buffer.alloc(data.length, 0));
    await assert.rejects(verifyReleaseDirectory(dir, version));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('完整发版缺任一平台更新清单时失败，空目录不能假绿', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-release-empty-'));
  try {
    await assert.rejects(verifyReleaseDirectory(dir, version));
    await writeFile(path.join(dir, 'latest-mac.yml'), stringify(arm));
    await writeFile(path.join(dir, arm.files[0].url), data);
    await assert.rejects(verifyReleaseDirectory(dir, version, { allPlatforms: true }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('发布 workflow 必须先跑完整检查，显式选择签名，最终仅保留草稿', async () => {
  const workflow = parse(
    await readFile(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8')
  );
  const steps = workflow.jobs['build-app'].steps;
  const gate = steps.findIndex((step) => step.run === 'pnpm release:check');
  assert.ok(gate >= 0 && gate < steps.findIndex((step) => step.run === 'pnpm build'));
  const macBuild = workflow.jobs['build-mac'].steps.find((step) =>
    step.name.startsWith('Build macOS')
  );
  assert.match(macBuild.run, /-c\.mac\.identity=/);
  const finalSteps = workflow.jobs['generate-release-notes'].steps;
  assert.ok(finalSteps.some((step) => step.run?.includes('verify release-assets --all-platforms')));
  const publication = finalSteps.at(-1).run;
  assert.match(publication, /gh release edit.*--draft --notes-file/);
  assert.doesNotMatch(publication, /--draft=false|--latest/);
});

test('完整发版包含两架构 Mac、Windows、Linux 的有效清单与安装包才通过', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-release-all-'));
  try {
    const manifests = {
      'latest-mac.yml': mergeMacManifests(arm, intel, version),
      'latest.yml': manifest(`EnsoCode-Setup-${version}.exe`),
      'latest-linux.yml': {
        version,
        files: [
          ...manifest(`enso-code-${version}.AppImage`).files,
          ...manifest(`enso-code_${version}_amd64.deb`).files,
        ],
      },
    };
    for (const [name, entry] of Object.entries(manifests)) {
      await writeFile(path.join(dir, name), stringify(entry));
      for (const file of entry.files) await writeFile(path.join(dir, file.url), data);
    }
    await verifyReleaseDirectory(dir, version, { allPlatforms: true });
    assert.match(await readFile(path.join(dir, 'SHA256SUMS'), 'utf8'), /latest-mac.yml/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
