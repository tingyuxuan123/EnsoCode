import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import * as personalRelease from './personal-release.mjs';
import * as release from './release.mjs';

const { assertReleaseVersion, mergeMacManifests, verifyReleaseDirectory } = release;

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

test('个人 tag 校验不放宽正式版本校验，错误版本与相似前缀均拒绝', () => {
  assert.equal(typeof release.assertReleaseRef, 'function');
  const { assertReleaseRef } = release;
  assert.equal(assertReleaseRef(version, `refs/tags/personal-v${version}`), version);
  assert.equal(assertReleaseRef(version, `refs/tags/v${version}`), version);
  assert.equal(assertReleaseRef(version, 'refs/heads/main'), version);
  for (const ref of [
    'refs/tags/personal-v0.2.9',
    'refs/tags/personal-v0.2.10-evil',
    'refs/tags/other',
  ]) {
    assert.throws(() => assertReleaseRef(version, ref));
  }
  assert.throws(() => assertReleaseVersion(version, `personal-v${version}`));
});

test('个人更新清单只能前进，按数字比较，不能降级或覆盖同版本', () => {
  assert.equal(typeof personalRelease.assertPersonalFeedAdvance, 'function');
  const { assertPersonalFeedAdvance } = personalRelease;
  assert.doesNotThrow(() => assertPersonalFeedAdvance('0.2.9', '0.2.10'));
  assert.doesNotThrow(() => assertPersonalFeedAdvance('0.2.18', '0.3.0'));
  for (const [current, next] of [
    ['0.2.18', '0.2.18'],
    ['0.2.18', '0.2.17'],
    ['0.10.0', '0.9.99'],
    ['bad', '0.2.19'],
  ])
    assert.throws(() => assertPersonalFeedAdvance(current, next));
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

test('个人 tag 自动构建，受信 main 校验先于证书使用，手动构建仍仅产出 artifact', async () => {
  const file = new URL('../.github/workflows/build-personal-mac.yml', import.meta.url);
  assert.ok(existsSync(file), '需要独立的个人 Mac 构建 workflow');
  const workflow = parse(await readFile(file, 'utf8'));
  assert.deepEqual(workflow.on.push?.tags, ['personal-v*']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.match(workflow.jobs['build-personal-mac'].if, /refs\/heads\/main/);
  assert.match(workflow.jobs['build-personal-mac'].if, /personal-v/);
  const steps = workflow.jobs['build-personal-mac'].steps;
  assert.equal(
    steps.find((step) => step.name === 'Install dependencies').env?.GITHUB_TOKEN,
    `\${{ secrets.GITHUB_TOKEN }}`
  );
  const gate = steps.findIndex((step) => step.run === 'pnpm release:check');
  const signing = steps.findIndex((step) => step.name === 'Import personal signing certificate');
  assert.ok(gate >= 0 && gate < signing);
  const trusted = steps.findIndex((step) => step.name === 'Validate trusted release ref');
  assert.ok(trusted >= 0 && trusted < gate);
  assert.match(steps[trusted].run, /merge-base --is-ancestor/);
  const imported = steps[signing];
  assert.equal(imported.env.LOCAL_SIGNING_CERTIFICATE, `\${{ secrets.LOCAL_SIGNING_CERTIFICATE }}`);
  assert.equal(imported.env.LOCAL_SIGNING_PASSWORD, `\${{ secrets.LOCAL_SIGNING_PASSWORD }}`);
  assert.match(workflow.env.EXPECTED_SHA1, /^[A-F0-9]{40}$/);
  assert.match(imported.run, /\^\[A-F0-9\]\{40\}\$/);
  assert.match(imported.run, /find-identity/);
  // 原 Secret 导出的 P12 不含证书：公钥证书入库，私钥仍只从 Secret 导入，按指纹配对。
  assert.match(imported.run, /build\/personal-signing\.pem/);
  assert.match(imported.run, /security import "\$CERT_PATH"/);
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
  assert.equal(artifact.with.path, 'dist/release-assets/');
  for (const required of [
    'dist/*.zip',
    'dist/*.dmg',
    'dist/latest-mac.yml',
    'release.mjs verify dist/release-assets',
  ]) {
    assert.ok(verification.run.includes(required));
  }
  const cleanup = steps.find((step) => step.name === 'Clean personal signing material');
  assert.equal(cleanup.if, 'always()');
  assert.equal(cleanup['timeout-minutes'], 2);
  assert.match(cleanup.run, /node scripts\/personal-signing\.mjs/);
  const publicCleanup = workflow.jobs['publish-personal'].steps.find(
    (step) => step.name === 'Clean public verification certificate'
  );
  assert.equal(publicCleanup['timeout-minutes'], 2);
  assert.match(publicCleanup.run, /node scripts\/personal-signing\.mjs --public/);
  assert.doesNotMatch(JSON.stringify(workflow), /APPLE_CERTIFICATE/);
  const publicCert = await readFile(
    new URL('../build/personal-signing.pem', import.meta.url),
    'utf8'
  );
  assert.match(publicCert, /BEGIN CERTIFICATE/);
  assert.doesNotMatch(publicCert, /PRIVATE KEY/);
  assert.equal(
    new X509Certificate(publicCert).fingerprint.replaceAll(':', ''),
    workflow.env.EXPECTED_SHA1
  );
});

const signingCleanup = async () => {
  const file = new URL('./personal-signing.mjs', import.meta.url);
  assert.ok(existsSync(file), '需要有界、非交互的 CI 签名材料清理器');
  return import(file.href);
};

test('CI 清理的系统命令会在超时后真正终止，不只让等待 Promise 超时', async () => {
  const { runCleanupCommand } = await signingCleanup();
  const result = await runCleanupCommand(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    100
  );
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
});

test('sudo 内部也有硬截止，不依赖普通用户终止 root 子进程', {
  skip: process.platform === 'win32',
}, async () => {
  const { runCleanupCommand } = await signingCleanup();
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-signing-sudo-'));
  const previousPath = process.env.PATH;
  const output = path.join(dir, 'args.json');
  try {
    // Fake sudo records argv only; this test never requests privileges or touches a keychain.
    await writeFile(
      path.join(dir, 'sudo'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o700 }
    );
    process.env.PATH = `${dir}${path.delimiter}${previousPath}`;
    assert.equal(
      (await runCleanupCommand('sudo', ['-n', 'security', 'remove-trusted-cert'], 1000)).ok,
      true
    );
    const args = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(args.slice(0, 3), ['-n', '/usr/bin/perl', '-e']);
    assert.match(args[3], /alarm.*exec/);
    assert.deepEqual(args.slice(4), ['1', 'security', 'remove-trusted-cert']);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('清理命令即使超时也先删除私钥包，随后移除独立钥匙串与证书文件', async () => {
  const { cleanupPersonalSigning } = await signingCleanup();
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-signing-cleanup-'));
  const files = ['personal-signing.p12', 'personal-signing.keychain-db', 'personal-signing.pem'];
  try {
    for (const file of files) await writeFile(path.join(dir, file), 'fixture');
    const seen = [];
    const warnings = await cleanupPersonalSigning({
      tempDir: dir,
      run(command, args, timeoutMs) {
        assert.equal(existsSync(path.join(dir, 'personal-signing.p12')), false);
        seen.push({ command, args, timeoutMs });
        return { ok: false, timedOut: true };
      },
    });
    assert.ok(warnings.length > 0);
    for (const file of files) assert.equal(existsSync(path.join(dir, file)), false);
    assert.ok(seen.every((call) => call.timeoutMs > 0 && call.timeoutMs <= 15_000));
    assert.ok(seen.some((call) => call.command === 'sudo' && call.args[0] === '-n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('清理只操作 RUNNER_TEMP 中的专用文件，未创建签名材料时不调用钥匙串命令', async () => {
  const { cleanupPersonalSigning } = await signingCleanup();
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-signing-cleanup-empty-'));
  try {
    assert.deepEqual(
      await cleanupPersonalSigning({ tempDir: dir, run: () => assert.fail('不得调用') }),
      []
    );
    await assert.rejects(cleanupPersonalSigning({ tempDir: '' }));
    await assert.rejects(cleanupPersonalSigning({ tempDir: 'relative' }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('个人发布仅 tag 触发写权限，下载验收后公开并推进清单，不改正式 latest', async () => {
  const workflow = parse(
    await readFile(new URL('../.github/workflows/build-personal-mac.yml', import.meta.url), 'utf8')
  );
  const publish = workflow.jobs['publish-personal'];
  assert.ok(publish, '需要 tag 驱动的个人发布 job');
  assert.equal(publish.needs, 'build-personal-mac');
  assert.match(publish.if, /github.event_name == 'push'/);
  assert.match(publish.if, /refs\/tags\/personal-v/);
  assert.deepEqual(publish.permissions, { contents: 'write' });
  assert.equal(workflow.concurrency.group, 'personal-updates');
  const steps = publish.steps;
  const draft = steps.findIndex((step) => step.name === 'Upload draft release');
  const verify = steps.findIndex((step) => step.name === 'Verify remote draft assets');
  const open = steps.findIndex((step) => step.name === 'Publish personal prerelease');
  const publicVerify = steps.findIndex((step) => step.name === 'Verify public assets');
  const feed = steps.findIndex((step) => step.name === 'Advance personal update feed');
  assert.ok(
    draft >= 0 && draft < verify && verify < open && open < publicVerify && publicVerify < feed
  );
  assert.match(steps[draft].run, /--draft/);
  assert.match(steps[verify].run, /gh release download/);
  assert.match(steps[verify].run, /shasum -a 256 -c/);
  assert.match(steps[verify].run, /codesign --verify/);
  assert.match(steps[open].run, /--draft=false --prerelease --latest=false/);
  assert.match(steps[publicVerify].run, /curl.*--max-time/);
  assert.match(steps[feed].run, /assertPersonalFeedAdvance/);
  assert.match(steps[feed].run, /HEAD:personal-updates/);
  assert.doesNotMatch(steps[feed].run, /--force/);
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
