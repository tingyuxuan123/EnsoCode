/** Explicit emulator-only check of the production App -> Keystore -> OkHttp -> relay path. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('ANDROID_HOME must identify the local Android SDK');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.env.EAVES_TEST_EMULATOR ?? 'emulator-5554';
const pkg = 'io.github.tingyuxuan123.eaves';
const runner = `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`;
const testClass = `${pkg}.PairingLoopbackTest`;
const output = path.join(root, 'temp/eaves-pair-live');
const temporary = await mkdtemp(path.join(tmpdir(), 'eaves-app-pair-'));
const children = [];
const watchMode = process.env.EAVES_BACKGROUND_SMOKE === '1';
let grantedWatchPermission = false;

function command(binary, args, timeout = 20_000) {
  const result = spawnSync(binary, args, {
    cwd: root,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('Fixture command failed (output withheld)');
  return result.stdout;
}
function android(...args) {
  return command(adb, ['-s', serial, ...args]);
}
function start(binary, args, cwd) {
  const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.push(child);
  let text = '';
  child.stdout.on('data', (chunk) => {
    if (text.length < 256_000) text += chunk;
  });
  child.stderr.resume();
  const ready = (pattern) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Fixture readiness timed out')), 15_000);
      const inspect = () => {
        const match = pattern.exec(text);
        if (match) finish(null, match);
      };
      const ended = () => finish(new Error('Fixture ended before readiness'));
      function finish(error, value) {
        clearTimeout(timer);
        child.stdout.off('data', inspect);
        child.off('exit', ended);
        child.off('error', ended);
        if (error) reject(error);
        else resolve(value);
      }
      child.stdout.on('data', inspect);
      child.once('exit', ended);
      child.once('error', ended);
      inspect();
    });
  return { child, ready };
}
function instrument(method, extras) {
  const args = ['shell', 'am', 'instrument', '-w', '-r', '-e', 'class', `${testClass}#${method}`];
  for (const [key, value] of Object.entries(extras)) args.push('-e', key, value);
  const result = command(adb, ['-s', serial, ...args, runner], 90_000).toString('utf8');
  if (
    !/OK \(1 test\)/.test(result) ||
    /FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_STATUS_CODE: -[34]/.test(result)
  ) {
    const detail =
      method === 'backgroundWatchPostsAndOpensAuthenticatedTask' ? `\n${result.slice(-5500)}` : '';
    throw new Error(
      `App pairing instrumentation failed (${method}); inspect emulator test report${detail}`
    );
  }
}

let reversed;
let expectedId;
let night;
try {
  if (android('shell', 'getprop', 'ro.kernel.qemu').toString().trim() !== '1') {
    throw new Error('Refusing to run against a physical device');
  }
  // Never pm-clear or overwrite a developer's existing pairing, including a corrupt record.
  const guard = spawnSync(
    adb,
    ['-s', serial, 'shell', 'run-as', pkg, 'ls', 'no_backup/pair_credentials.bin'],
    { encoding: 'utf8', timeout: 5000 }
  );
  if (guard.status === 0) throw new Error('Refusing to replace an existing App pairing');
  night = android('shell', 'cmd', 'uimode', 'night')
    .toString()
    .match(/Night mode: (\w+)/)?.[1];
  if (!night) throw new Error('Could not read the emulator theme before the fixture');
  await mkdir(output, { recursive: true });
  const binary = path.join(temporary, process.platform === 'win32' ? 'relay.exe' : 'relay');
  const build = spawnSync('go', ['build', '-o', binary, '.'], {
    cwd: path.join(root, 'packages/relay-go'),
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (build.status !== 0) throw new Error('Could not build the disposable Go relay');
  const relay = start(
    binary,
    ['-listen', '127.0.0.1:0', '-db', path.join(temporary, 'relay.sqlite'), '-auto-update=false'],
    temporary
  );
  const origin = (await relay.ready(/http:\/\/127\.0\.0\.1:(\d+)\r?\n/))[0].trim();
  const port = new URL(origin).port;
  android('reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`);
  reversed = port;
  android('install', '-r', path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'));
  android(
    'install',
    '-r',
    path.join(root, 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')
  );
  if (watchMode) {
    const alreadyAllowed = android('shell', 'dumpsys', 'package', pkg)
      .toString()
      .includes('android.permission.POST_NOTIFICATIONS: granted=true');
    if (!alreadyAllowed) {
      android('shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
      grantedWatchPermission = true;
    }
  }
  const host = start(
    process.execPath,
    [path.join(root, 'scripts/pair-fake-host.mjs'), '--relay', origin],
    root
  );
  const invite = (await host.ready(/^Pair link: (\S+)\r?$/m))[1];
  const publicKey = new URLSearchParams(new URL(invite).hash.slice(1)).get('pk');
  expectedId = createHash('sha256')
    .update(publicKey)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  android('shell', 'cmd', 'uimode', 'night', 'no');
  instrument('claimAndShowAuthenticatedCatalog', {
    eavesPairInviteB64: Buffer.from(invite).toString('base64url'),
  });
  await writeFile(
    path.join(output, 'pair-light.png'),
    android('exec-out', 'run-as', pkg, 'cat', 'cache/pair-connected-light.png')
  );
  await writeFile(
    path.join(output, 'catalog-light.png'),
    android('exec-out', 'run-as', pkg, 'cat', 'cache/pair-catalog-light.png')
  );
  android('shell', 'am', 'force-stop', pkg);
  android('shell', 'cmd', 'uimode', 'night', 'yes');
  if (watchMode)
    instrument('backgroundWatchPostsAndOpensAuthenticatedTask', { eavesWatchPairId: expectedId });
  else
    instrument('restoreAfterProcessRestartAndUnpair', {
      eavesPairRestore: '1',
      eavesPairExpectedId: expectedId,
      eavesSessionFlow: process.env.EAVES_SESSION_SMOKE === '1' ? '1' : '0',
    });
  if (!watchMode)
    await writeFile(
      path.join(output, 'catalog-dark.png'),
      android('exec-out', 'run-as', pkg, 'cat', 'cache/pair-catalog-dark.png')
    );
  if (watchMode) {
    try {
      await writeFile(
        path.join(output, 'watch-notification.png'),
        android('exec-out', 'run-as', pkg, 'cat', 'cache/watch-notification.png')
      );
    } catch {
      /* An OEM may not expose a notification-card accessibility rectangle. */
    }
    await writeFile(
      path.join(output, 'watch-opened.png'),
      android('exec-out', 'run-as', pkg, 'cat', 'cache/watch-opened.png')
    );
    console.log(
      'Foreground service retained authenticated catalog while the emulator screen was off; a task notification opened its exact session, and stop cleared notifications.'
    );
  }
  if (!watchMode && process.env.EAVES_SESSION_SMOKE === '1') {
    for (const name of [
      'session-approval-dark.png',
      'session-ask-dark.png',
      'session-complete-dark.png',
      'session-steer-dark.png',
      'session-queue-dark.png',
      'new-config-dark.png',
      'new-task-running-dark.png',
    ]) {
      await writeFile(
        path.join(output, name),
        android('exec-out', 'run-as', pkg, 'cat', `cache/${name}`)
      );
    }
    console.log(
      'Android session subscribed, approval/question resolved, prompt/steer/queue/stop observed, then configured task created and first output received.'
    );
  }
  console.log(
    'Android App paired, authenticated catalog loaded, process restart restored, and unpair cleared credentials.'
  );
  console.log(`Screenshots: ${output}`);
} finally {
  if (expectedId) {
    try {
      instrument('cleanupLoopbackFixture', { eavesPairCleanup: expectedId });
    } catch {
      console.error('Fixture cleanup needs attention; no existing pairing was overwritten.');
      process.exitCode = 1;
    }
  }
  if (reversed) {
    try {
      android('reverse', '--remove', `tcp:${reversed}`);
    } catch {
      console.error('Could not remove fixture adb reverse mapping.');
    }
  }
  if (night) {
    try {
      android('shell', 'cmd', 'uimode', 'night', night);
    } catch {
      console.error('Could not restore emulator theme.');
    }
  }
  if (grantedWatchPermission) {
    try {
      android('shell', 'pm', 'revoke', pkg, 'android.permission.POST_NOTIFICATIONS');
    } catch {
      console.error('Could not restore notification permission.');
      process.exitCode = 1;
    }
  }
  for (const child of children.reverse()) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000).unref();
      await exited;
      clearTimeout(timer);
    }
  }
  await rm(temporary, { recursive: true, force: true });
}
