// Run with the packaged executable and ELECTRON_RUN_AS_NODE=1. Copy the
// engine to a writable directory like Main does; never write into the signed app.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function assertDesignDistribution(resources) {
  const root = path.join(resources, 'design');
  for (const file of [
    'LICENSE',
    'NOTICE',
    'UPSTREAM.md',
    'engine/package.json',
    'engine/vite.config.mjs',
    'engine/src/main.tsx',
    'engine/node_modules/vite/bin/vite.js',
    'skills/vetta-ui-design/SKILL.md',
    'agents/designer.md',
    'history-runner/runner.mjs',
    'history-runner/source/runner-entry.ts',
    'history-runner/source/archive.ts',
    'history-runner/source/isomorphic-git-join.js',
    'history-runner/source/build-tools.package.json',
    'history-runner/source/build-tools.package-lock.json',
    'history-runner/source/vite.runner.config.ts',
    'history-runner/LICENSES/fflate-MIT.txt',
    'history-runner/LICENSES/isomorphic-git-MIT.txt',
    'history-runner/LICENSES/LGPL-3.0.txt',
    'history-runner/LICENSES/GPL-3.0.txt',
  ]) {
    const stat = statSync(path.join(root, file));
    assert(stat.isFile() && stat.size > 0, `Empty distribution file: ${file}`);
  }
  return root;
}

function smoke(resources) {
  const root = assertDesignDistribution(resources);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-packaged-design-'));
  try {
    const engine = path.join(tmp, 'engine');
    const design = path.join(tmp, 'example.vetd');
    const output = path.join(tmp, 'output');
    mkdirSync(path.join(design, 'frames'), { recursive: true });
    writeFileSync(path.join(design, 'theme.css'), '@theme { --color-smoke: #134e4a; }');
    writeFileSync(
      path.join(design, 'frames/index.tsx'),
      'export default function Page() { return <h1 className="p-8">EnsoPackagedDesignSmoke</h1>; }'
    );
    cpSync(path.join(root, 'engine'), engine, { recursive: true, verbatimSymlinks: true });
    const run = (args, cwd) =>
      execFileSync(process.execPath, args, {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VETD_SRC: design },
        encoding: 'utf8',
        timeout: 60_000,
      });
    run(['node_modules/vite/bin/vite.js', 'build', '--outDir', output], engine);
    const assets = path.join(output, 'assets');
    assert(
      readdirSync(assets).some(
        (file) =>
          file.endsWith('.js') &&
          readFileSync(path.join(assets, file), 'utf8').includes('EnsoPackagedDesignSmoke')
      ),
      'Packaged Vite did not compile the external design frame'
    );
    console.log('ok   design: Vite compiled the fixture with packaged dependencies');

    const history = (cmd, options = {}) => {
      const result = JSON.parse(
        run(
          [
            path.join(root, 'history-runner/runner.mjs'),
            JSON.stringify({ cmd, dir: design, ...options }),
          ],
          tmp
        )
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      return result;
    };
    history('init');
    assert.equal(history('commit', { title: 'Package smoke' }).committed, true);
    console.log('ok   design: history commit and required source/license files');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { assertDesignDistribution };
if (require.main === module) {
  assert(process.argv[2], 'Pass the packaged app Resources directory');
  smoke(path.resolve(process.argv[2]));
}
