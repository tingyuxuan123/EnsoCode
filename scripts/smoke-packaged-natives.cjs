// 用打包产物自带的 Electron 以 node 模式真实加载每个原生依赖、执行每个内置二进制。
// 用法：ELECTRON_RUN_AS_NODE=1 <打包后的可执行文件> scripts/smoke-packaged-natives.cjs <resources 目录>
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const resources = path.resolve(process.argv[2] ?? '');
const appRequire = createRequire(path.join(resources, 'app.asar', 'package.json'));
const appImport = (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const unpacked = (file) => file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const isWindows = process.platform === 'win32';

const checks = {
  'better-sqlite3 (fts5)': () => {
    const Database = appRequire('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='trigram')");
      db.prepare('INSERT INTO t VALUES (?)').run('Collabra Markdown Wiki 记忆索引');
      const row = db.prepare("SELECT body FROM t WHERE t MATCH 'Wiki'").get();
      if (!row) throw new Error('fts5 trigram match missing');
      return 'fts5-trigram-ok';
    } finally {
      db.close();
    }
  },
  'classic-level': async () => {
    const { Level } = await appImport('level');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'enso-smoke-level-'));
    try {
      const db = new Level(dir);
      await db.put('k', 'v');
      const value = await db.get('k');
      await db.close();
      return value;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  'node-pty': () =>
    new Promise((resolve, reject) => {
      const pty = appRequire('node-pty');
      const [file, args] = isWindows
        ? ['cmd.exe', ['/c', 'echo pty-ok']]
        : ['/bin/echo', ['pty-ok']];
      const term = pty.spawn(file, args, { cols: 80, rows: 24 });
      let output = '';
      term.onData((data) => {
        output += data;
      });
      term.onExit(({ exitCode }) =>
        exitCode === 0 && output.includes('pty-ok')
          ? resolve('pty-ok')
          : reject(new Error(`exit ${exitCode}: ${output}`))
      );
    }),
  'node-datachannel': async () => {
    const ndc = await appImport('node-datachannel');
    const peer = new ndc.PeerConnection('smoke', { iceServers: [] });
    peer.close();
    return 'loaded';
  },
  koffi: () => {
    const koffi = appRequire('koffi');
    const lib =
      {
        darwin: '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics',
        win32: 'user32.dll',
      }[process.platform] ?? 'libc.so.6';
    koffi.load(lib).unload();
    return `${koffi.version} loaded ${lib}`;
  },
  'pi-tui native': async () => {
    const { getNativeClipboard } = await appImport('@earendil-works/pi-tui');
    // Linux 原生剪贴板依赖 X11 DISPLAY，CI 无头环境按设计返回 undefined
    if (process.platform === 'linux' && !process.env.DISPLAY) return 'skipped (no DISPLAY)';
    const helper = getNativeClipboard();
    if (typeof helper?.getText !== 'function') throw new Error('native clipboard helper missing');
    return 'loaded';
  },
  ripgrep: () =>
    execFileSync(unpacked(appRequire('@vscode/ripgrep').rgPath), ['--version'])
      .toString()
      .split('\n')[0],
  rtk: () =>
    execFileSync(path.join(resources, 'rtk', isWindows ? 'rtk.exe' : 'rtk'), ['--version'])
      .toString()
      .trim(),
};

(async () => {
  let failed = false;
  for (const [name, check] of Object.entries(checks)) {
    try {
      console.log(`ok   ${name}: ${await check()}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${name}: ${error instanceof Error ? error.stack : error}`);
    }
  }
  console.log(`arch ${process.arch}, electron ${process.versions.electron}`);
  process.exit(failed ? 1 : 0);
})();
