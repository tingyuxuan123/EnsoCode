import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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

test('个人自签名构建仅手动触发，验明证书身份且不发布 Release', async () => {
  const file = new URL('../.github/workflows/build-personal-mac.yml', import.meta.url);
  assert.ok(existsSync(file), '需要独立的个人 Mac 构建 workflow');
  const workflow = parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const fingerprint = workflow.on.workflow_dispatch.inputs.certificate_sha1;
  assert.equal(fingerprint.required, true);
  assert.match(fingerprint.default, /^[A-F0-9]{40}$/);
  assert.equal(workflow.jobs['build-personal-mac'].if, "github.ref == 'refs/heads/main'");
  const steps = workflow.jobs['build-personal-mac'].steps;
  assert.equal(
    steps.find((step) => step.name === 'Install dependencies').env?.GITHUB_TOKEN,
    `\${{ secrets.GITHUB_TOKEN }}`
  );
  const gate = steps.findIndex((step) => step.run === 'pnpm release:check');
  const signing = steps.findIndex((step) => step.name === 'Import personal signing certificate');
  assert.ok(gate >= 0 && gate < signing);
  const imported = steps[signing];
  assert.equal(imported.env.LOCAL_SIGNING_CERTIFICATE, `\${{ secrets.LOCAL_SIGNING_CERTIFICATE }}`);
  assert.equal(imported.env.LOCAL_SIGNING_PASSWORD, `\${{ secrets.LOCAL_SIGNING_PASSWORD }}`);
  assert.equal(imported.env.EXPECTED_SHA1, `\${{ inputs.certificate_sha1 }}`);
  assert.match(imported.run, /\^\[A-F0-9\]\{40\}\$/);
  assert.match(imported.run, /find-identity/);
  // 钥匙串导出的自签名证书不一定被 PKCS#12 标成 client certificate。
  assert.match(imported.run, /pkcs12[^\n]*-in/);
  assert.doesNotMatch(imported.run, /-clcerts/);
  assert.match(imported.run, /sudo security add-trusted-cert -d/);
  const build = steps.find((step) => step.name === 'Build personal Mac package');
  assert.match(build.run, /--mac --arm64 --publish never/);
  assert.match(build.run, /-c\.mac\.identity="\$MAC_SIGNING_IDENTITY"/);
  assert.match(build.run, /-c\.mac\.notarize=false/);
  assert.match(build.run, /--config electron-builder\.personal\.yml/);
  const verification = steps.find((step) => step.name === 'Verify personal Mac package');
  assert.match(verification.run, /codesign --verify --deep --strict/);
  assert.match(verification.run, /codesign --verify -R=/);
  assert.match(verification.run, /release\.mjs verify dist/);
  const artifact = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
  for (const required of ['dist/*.zip', 'dist/*.dmg', 'dist/latest-mac.yml', 'dist/SHA256SUMS']) {
    assert.ok(artifact.with.path.includes(required));
  }
  const cleanup = steps.find((step) => step.name === 'Clean personal signing material');
  assert.equal(cleanup.if, 'always()');
  assert.match(cleanup.run, /sudo security remove-trusted-cert -d/);
  assert.match(cleanup.run, /delete-keychain/);
  assert.match(cleanup.run, /rm -f/);
  assert.doesNotMatch(JSON.stringify(workflow), /gh release|APPLE_CERTIFICATE/);
});

test('个人安装包只使用独立 generic 更新源，正式 GitHub 更新源不变', async () => {
  const file = new URL('../electron-builder.personal.yml', import.meta.url);
  assert.ok(existsSync(file), '需要隔离个人更新源的构建配置');
  const personal = parse(await readFile(file, 'utf8'));
  assert.equal(personal.extends, './electron-builder.yml');
  assert.deepEqual(personal.publish, [
    {
      provider: 'generic',
      url: 'https://raw.githubusercontent.com/tingyuxuan123/EnsoCode/personal-updates/',
      useMultipleRangeRequest: false,
    },
  ]);
  const official = parse(
    await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  );
  assert.equal(official.publish.provider, 'github');
  assert.equal(official.publish.releaseType, 'draft');
});

test('个人清单只在安装包校验后生成，使用不可变个人 Release URL且保留校验值', async () => {
  const file = new URL('./personal-release.mjs', import.meta.url);
  assert.ok(existsSync(file), '需要个人更新清单生成器');
  const { preparePersonalFeed } = await import(file.href);
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-personal-feed-'));
  try {
    const source = path.join(dir, 'package');
    const output = path.join(dir, 'feed');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(source);
    await writeFile(
      path.join(source, 'latest-mac.yml'),
      stringify({ ...arm, path: arm.files[0].url, sha512 })
    );
    await assert.rejects(preparePersonalFeed(source, output, version));
    assert.equal(existsSync(path.join(output, 'latest-mac.yml')), false);
    await writeFile(path.join(source, arm.files[0].url), data);
    await preparePersonalFeed(source, output, version);
    const feed = parse(await readFile(path.join(output, 'latest-mac.yml'), 'utf8'));
    const url = `https://github.com/tingyuxuan123/EnsoCode/releases/download/personal-v${version}/${arm.files[0].url}`;
    assert.equal(feed.version, version);
    assert.equal(feed.files[0].url, url);
    assert.equal(feed.path, url);
    assert.equal(feed.files[0].sha512, sha512);
    assert.equal(feed.files[0].size, data.length);
    assert.match(feed.releaseNotes, /个人测试/);
    await writeFile(path.join(source, arm.files[0].url), Buffer.alloc(data.length, 1));
    await assert.rejects(preparePersonalFeed(source, path.join(dir, 'corrupt'), version));
    await assert.rejects(preparePersonalFeed(source, output, '0.2.11'));
    await writeFile(
      path.join(source, 'latest-mac.yml'),
      stringify(manifest('https://evil.example/a.zip'))
    );
    await assert.rejects(preparePersonalFeed(source, path.join(dir, 'unsafe'), version));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
