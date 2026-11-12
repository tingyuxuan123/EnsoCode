import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import * as personalRelease from './personal-release.mjs';
import * as release from './release.mjs';

const { assertReleaseVersion, mergeMacManifests, verifyReleaseDirectory } = release;

const version = '0.2.10';
const data = Buffer.from('test installer');
const sha512 = createHash('sha512').update(data).digest('base64');
const manifest = (url) => ({ version, files: [{ url, sha512, size: data.length }] });
const arm = manifest(`Collabra-${version}-arm64-mac.zip`);
const intel = manifest(`Collabra-${version}-mac.zip`);

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

test('Windows 专用 tag 严格匹配版本，不触发 Mac 或多平台发布', async () => {
  assert.equal(release.assertReleaseRef(version, `refs/tags/windows-v${version}`), version);
  for (const ref of ['refs/tags/windows-v0.2.9', 'refs/tags/windows-v0.2.10-evil']) {
    assert.throws(() => release.assertReleaseRef(version, ref));
  }
  assert.throws(() => assertReleaseVersion(version, `windows-v${version}`));
  const workflow = parse(
    await readFile(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8')
  );
  assert.deepEqual(workflow.on.push.tags, ['windows-v*']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['build-app', 'build-windows', 'publish-windows']);
  const build = workflow.jobs['build-windows'];
  assert.equal(build['runs-on'], 'windows-2022');
  assert.equal(build.needs, 'build-app');
  const steps = build.steps;
  const appSteps = workflow.jobs['build-app'].steps;
  const gate = appSteps.findIndex((step) => step.run === 'pnpm release:check');
  const pack = steps.findIndex((step) => step.name === 'Build Windows');
  const designPaths = steps.findIndex((step) => step.name === 'Verify Windows design paths');
  assert.ok(gate >= 0 && gate < appSteps.findIndex((step) => step.run === 'pnpm build'));
  assert.ok(designPaths >= 0 && designPaths < pack);
  assert.match(steps[designPaths].run, /windowsDesignPath\.test\.ts/);
  assert.match(steps[pack].run, /--win --x64 --publish never/);
  assert.ok(steps.some((step) => step.run?.includes('smoke-packaged-natives.cjs')));
  assert.ok(steps.some((step) => step.run?.includes('smoke-packaged-design.cjs')));
  assert.ok(steps.some((step) => step.run?.includes('release.mjs verify dist/release-assets')));
  const publish = workflow.jobs['publish-windows'];
  assert.equal(publish.needs, 'build-windows');
  assert.deepEqual(publish.permissions, { contents: 'write' });
  assert.match(publish.if, /github.event_name == 'push'/);
  assert.match(publish.if, /refs\/tags\/windows-v/);
  assert.equal(publish.concurrency.group, 'windows-latest');
  const publication = publish.steps.find((step) => step.name === 'Upload verified Windows draft');
  const newer = publish.steps.find(
    (step) => step.name === 'Require a newer release than current Latest'
  );
  assert.ok(newer && publish.steps.indexOf(newer) < publish.steps.indexOf(publication));
  assert.match(newer.run, /releases\/latest/);
  assert.match(newer.run, /sort -V/);
  assert.match(publication.run, /--draft/);
  assert.match(publication.run, /--latest=false/);
  assert.match(publication.run, /--verify-tag/);
  const remote = publish.steps.find((step) => step.name === 'Verify remote Windows draft');
  assert.match(remote.run, /gh release download/);
  assert.match(remote.run, /release.mjs verify downloaded/);
  assert.match(remote.run, /diff.*SHA256SUMS/);
  const publishIndex = publish.steps.findIndex((step) => step.name === 'Publish Windows release');
  const publicIndex = publish.steps.findIndex(
    (step) => step.name === 'Verify public Windows assets'
  );
  const latestIndex = publish.steps.findIndex(
    (step) => step.name === 'Promote Windows release to Latest'
  );
  assert.ok(publishIndex > publish.steps.indexOf(remote));
  assert.ok(publicIndex > publishIndex && latestIndex > publicIndex);
  assert.match(publish.steps[publishIndex].run, /--draft=false --prerelease=false --latest=false/);
  assert.match(publish.steps[publicIndex].run, /curl.*--fail.*--location/);
  assert.match(publish.steps[publicIndex].run, /release.mjs verify public-assets/);
  assert.match(publish.steps[publicIndex].run, /cmp.*SHA256SUMS/);
  assert.match(publish.steps[latestIndex].run, /--latest=true/);
  assert.match(publish.steps[latestIndex].run, /releases\/latest/);
  assert.doesNotMatch(JSON.stringify(workflow), /--mac|--linux|personal-updates|APPLE_CERTIFICATE/);
});

test('Windows 手动安装提供目录选择，默认不强制全用户安装', async () => {
  const config = parse(await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'));
  assert.deepEqual(config.win.target, ['nsis']);
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true);
  assert.notEqual(config.nsis.perMachine, true);
  assert.notEqual(config.nsis.selectPerMachineByDefault, true);
});

test('Windows 应用内升级保持静默，跳过安装向导并沿用已注册目录', async () => {
  const config = parse(await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'));
  assert.equal(config.nsis.include, 'build/installer.nsh');
  const installer = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  // 合约检查，不代表已在 Windows 上完成安装/升级验收。
  // SetSilent 只作用于 electron-updater 的 --updated；不覆盖 $INSTDIR，保留 NSIS 的注册表恢复逻辑。
  assert.match(
    installer,
    /!macro customInit\s+\$\{if\} \$\{isUpdated\}\s+SetSilent silent\s+\$\{endif\}\s+!macroend/
  );
  assert.doesNotMatch(installer, /StrCpy\s+\$INSTDIR\b/);
});

test('仅 Windows 产物可独立校验，坏安装包与缺失清单不能发布', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-release-windows-'));
  const windows = manifest(`EnsoCode-Setup-${version}.exe`);
  try {
    await writeFile(path.join(dir, windows.files[0].url), data);
    await assert.rejects(verifyReleaseDirectory(dir, version));
    await writeFile(path.join(dir, 'latest.yml'), stringify(windows));
    await verifyReleaseDirectory(dir, version);
    assert.match(await readFile(path.join(dir, 'SHA256SUMS'), 'utf8'), /latest\.yml/);
    await assert.rejects(verifyReleaseDirectory(dir, version, { allPlatforms: true }));
    await writeFile(path.join(dir, windows.files[0].url), Buffer.alloc(data.length));
    await assert.rejects(verifyReleaseDirectory(dir, version));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows Latest 防倒退执行真实 shell：按数字比较，旧版与同版本拒绝', async () => {
  const workflow = parse(
    await readFile(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8')
  );
  const step = workflow.jobs['publish-windows'].steps.find(
    (step) => step.name === 'Require a newer release than current Latest'
  );
  const run = (current, tag) =>
    // Git is already required by these integration tests; resolve its bundled Bash on Windows
    // rather than requiring a manual PATH edit (or accidentally invoking the WSL launcher).
    promisify(execFile)(
      process.platform === 'win32'
        ? path.resolve(
            execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
            '../../../bin/bash.exe'
          )
        : 'bash',
      ['-c', `gh() { printf '%s\\n' "$CURRENT_TAG"; }; ${step.run}`],
      {
        env: { ...process.env, CURRENT_TAG: current, TAG: tag, GITHUB_REPOSITORY: 'test/repo' },
      }
    );
  await run('windows-v0.2.9', 'windows-v0.2.10');
  await run('v0.2.9', 'windows-v0.3.0');
  for (const current of ['windows-v0.2.10', 'windows-v0.10.0', 'v1.0.0', 'unexpected'])
    await assert.rejects(run(current, 'windows-v0.2.10'));
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
  const notes = steps.findIndex((step) => step.name === 'Validate personal release notes');
  assert.ok(trusted < notes && notes < signing);
  assert.match(steps[notes].if, /github.event_name == 'push'/);
  assert.match(steps[notes].run, /node scripts\/personal-release\.mjs notes/);
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
      `#!${process.execPath}\nimport('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(process.argv.slice(2))));\n`,
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
  assert.match(steps[draft].run, /node scripts\/personal-release\.mjs notes/);
  assert.match(steps[draft].run, /gh release edit.*--notes-file/);
  assert.equal(steps[draft].run.match(/--notes-file/g)?.length, 2);
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

test('打包显示 Collabra 但沿用既有系统标识和可更新的 ASCII 安装包名', async () => {
  const config = parse(await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(config.productName, 'Collabra');
  assert.equal(config.appId, 'com.j3n5en.enso-code');
  assert.equal(pkg.name, 'enso-code');
  assert.equal(pkg.description, 'Collabra - AI 协作工作台');
  assert.equal(pkg.productName, undefined);
  assert.equal(config.extraMetadata?.productName, undefined);
  assert.equal(config.publish.repo, 'EnsoCode');
  assert.equal(config.win.executableName, 'Eaves');
  assert.equal(config.nsis.artifactName, `Collabra-Setup-\${version}.\${ext}`);
  assert.equal(config.mac.artifactName, `Collabra-\${version}-\${arch}-mac.\${ext}`);
  assert.equal(config.dmg.artifactName, `Collabra-\${version}-\${arch}.\${ext}`);
  assert.equal(config.linux.artifactName, `Collabra-\${version}-\${arch}.\${ext}`);
  for (const value of Object.values(config.mac.extendInfo).filter((v) => typeof v === 'string')) {
    assert.match(value, /^Collabra uses /);
  }
});

test('构建和远端验收使用 Collabra 资产及 Mac 二进制，Windows 二进制保持不变', async () => {
  for (const name of ['build.yml', 'build-personal-mac.yml', 'build-windows.yml']) {
    const source = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /小满|Xiaoman/);
    if (name !== 'build-windows.yml') {
      assert.match(source, /Collabra\.app/);
      assert.match(source, /Contents\/MacOS\/Collabra/);
    }
    if (name !== 'build-personal-mac.yml') assert.match(source, /win-unpacked\/Eaves\.exe/);
    assert.match(source, /Collabra-/);
  }
});

test('旧品牌日志仍可读取，但输出使用 Collabra 且证书原名不变', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-legacy-notes-'));
  try {
    for (const brand of ['小满', 'EnsoCode']) {
      await writeFile(path.join(dir, `${version}.md`), `# ${brand} ${version}\n\n- 旧版真实变更\n`);
      const notes = await personalRelease.readPersonalReleaseNotes(version, dir);
      assert.ok(notes.startsWith(`# Collabra ${version}\n\n- 旧版真实变更\n`));
      assert.match(notes, /信任 EnsoCode Local Signing 证书/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('个人清单只在安装包校验后生成，使用不可变个人 Release URL且保留校验值', async () => {
  const file = new URL('./personal-release.mjs', import.meta.url);
  assert.ok(existsSync(file), '需要个人更新清单生成器');
  const { preparePersonalFeed, readPersonalReleaseNotes } = await import(file.href);
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-personal-feed-'));
  try {
    const source = path.join(dir, 'package');
    const output = path.join(dir, 'feed');
    const notes = path.join(dir, 'release-notes');
    await mkdir(source);
    await mkdir(notes);
    await writeFile(path.join(notes, `${version}.md`), `# Collabra ${version}\n\n- 修复真实问题\n`);
    await writeFile(
      path.join(source, 'latest-mac.yml'),
      stringify({ ...arm, path: arm.files[0].url, sha512 })
    );
    await assert.rejects(preparePersonalFeed(source, output, version, notes));
    assert.equal(existsSync(path.join(output, 'latest-mac.yml')), false);
    await writeFile(path.join(source, arm.files[0].url), data);
    await preparePersonalFeed(source, output, version, notes);
    const feed = parse(await readFile(path.join(output, 'latest-mac.yml'), 'utf8'));
    const url = `https://github.com/tingyuxuan123/EnsoCode/releases/download/personal-v${version}/${arm.files[0].url}`;
    assert.equal(feed.version, version);
    assert.equal(feed.releaseName, `Collabra ${version} — 个人测试`);
    assert.equal(feed.files[0].url, url);
    assert.equal(feed.path, url);
    assert.equal(feed.files[0].sha512, sha512);
    assert.equal(feed.files[0].size, data.length);
    assert.equal(feed.releaseNotes, await readPersonalReleaseNotes(version, notes));
    assert.match(feed.releaseNotes, /修复真实问题/);
    assert.match(feed.releaseNotes, /信任 EnsoCode Local Signing 证书/);
    await assert.rejects(
      preparePersonalFeed(source, path.join(dir, 'missing-notes'), version, dir)
    );
    assert.equal(existsSync(path.join(dir, 'missing-notes', 'latest-mac.yml')), false);
    await writeFile(path.join(source, arm.files[0].url), Buffer.alloc(data.length, 1));
    await assert.rejects(preparePersonalFeed(source, path.join(dir, 'corrupt'), version, notes));
    await assert.rejects(preparePersonalFeed(source, output, '0.2.11', notes));
    await writeFile(
      path.join(source, 'latest-mac.yml'),
      stringify(manifest('https://evil.example/a.zip'))
    );
    await assert.rejects(preparePersonalFeed(source, path.join(dir, 'unsafe'), version, notes));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('个人日志必须是版本匹配、有正文的有限大小 UTF-8 文件', async () => {
  const { readPersonalReleaseNotes } = personalRelease;
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-personal-notes-'));
  const file = path.join(dir, `${version}.md`);
  try {
    await assert.rejects(() => readPersonalReleaseNotes(version, dir));
    for (const bad of [
      ' ',
      `# Collabra ${version}\n \n`,
      '# Collabra 0.2.11\n\n- Mismatched',
      `# Collabra ${version}\n\n${'长'.repeat(16384)}`,
      Buffer.concat([Buffer.from(`# Collabra ${version}\n\n`), Buffer.from([0xff])]),
    ]) {
      await writeFile(file, bad);
      await assert.rejects(() => readPersonalReleaseNotes(version, dir));
    }
    await writeFile(file, `# Collabra ${version}\r\n\r\n- Real changes\r\n`);
    assert.match(await readPersonalReleaseNotes(version, dir), /\n\n- Real changes\n/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI 按仓库版本读取日志，输出与 feed 同源的正文和安全说明', async () => {
  // Keep the fixture under the repo for dependency resolution, without requiring notes for
  // every future non-personal (e.g. Windows-only) package version just to run the test suite.
  const dir = await mkdtemp(fileURLToPath(new URL('../.personal-notes-cli-', import.meta.url)));
  try {
    const scripts = path.join(dir, 'scripts');
    const notes = path.join(dir, 'release-notes');
    await mkdir(scripts);
    await mkdir(notes);
    for (const name of ['personal-release.mjs', 'release.mjs']) {
      await copyFile(new URL(name, import.meta.url), path.join(scripts, name));
    }
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version }));
    const source = `# Collabra ${version}\n\n- Actual CLI changes\n`;
    await writeFile(path.join(notes, `${version}.md`), source);
    const { stdout } = await promisify(execFile)(process.execPath, [
      path.join(scripts, 'personal-release.mjs'),
      'notes',
    ]);
    assert.equal(stdout, await personalRelease.readPersonalReleaseNotes(version, notes));
    assert.ok(stdout.startsWith(source.trimEnd()));
    assert.match(stdout, /Mac arm64/);
    assert.match(stdout, /未公证/);
    assert.match(stdout, /安装与重启由用户操作/);
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '0.2.11' }));
    await assert.rejects(
      promisify(execFile)(process.execPath, [path.join(scripts, 'personal-release.mjs'), 'notes'])
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('个人日志拒绝符号链接文件与目录', { skip: process.platform === 'win32' }, async () => {
  const { readPersonalReleaseNotes } = personalRelease;
  const dir = await mkdtemp(path.join(tmpdir(), 'enso-personal-notes-link-'));
  try {
    const notes = path.join(dir, 'notes');
    const alias = path.join(dir, 'notes-alias');
    const outside = path.join(dir, 'valid.md');
    const file = path.join(notes, `${version}.md`);
    const valid = `# Collabra ${version}\n\n- Real changes\n`;
    await mkdir(notes);
    await writeFile(outside, valid);
    await symlink(outside, file);
    await assert.rejects(() => readPersonalReleaseNotes(version, notes));
    await rm(file);
    await writeFile(file, valid);
    await symlink(notes, alias, 'dir');
    await assert.rejects(() => readPersonalReleaseNotes(version, alias));
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
