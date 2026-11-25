import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';
import { activate } from '../main.mjs';

const id = 'llmdoc/architecture/知识.mdx';
const firstCursor = 'eyJvZmZzZXQiOjF9';
const markdown = '---\nkind: guide\ndescription: Example\n---\n\n# Example\n';
const readNames = [
  'context',
  'delta',
  'prune_report',
  'search',
  'show',
  'status',
  'tree',
  'upgrade',
  'validate',
];
const fakeCli = String.raw`
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const id = 'llmdoc/architecture/知识.mdx';
const args = process.argv.slice(2);
const command = args.find((arg) => ['tree', 'search', 'show', 'context', 'status', 'delta', 'validate', 'prune', 'upgrade'].includes(arg));
assert.ok(process.permission);
assert.equal(process.env.LLMDOC_TEST_SECRET, undefined);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.equal(process.env.PATH, undefined);
assert.equal(path.basename(realpathSync(process.cwd())), 'project');
assert.match(readFileSync(id, 'utf8'), /# Example/);
const cursor = 'eyJvZmZzZXQiOjF9';
const pagination = { totalItems: 2, returnedItems: 1, nextCursor: args.includes(cursor) ? null : cursor };
const entry = { path: id, description: 'An example', kind: 'guide', topic: 'architecture', extra: 'private' };
const summaries = { total: 1, impacted: 0, needsReview: 1, dirty: 0 };
const unmapped = { committed: [], dirty: [] };
const git = (args) => spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
const safeGit = (...args) => git(['-c', 'core.quotePath=false', ...args]);
let result;
if (command === 'tree') {
  assert.deepEqual(args, ['--json', '--limit', '30', '--budget', '1400', ...(args.includes(cursor) ? ['--cursor', cursor] : []), 'tree', '--docs']);
  result = { root: 'llmdoc', documents: [entry], pagination };
} else if (command === 'search') {
  const query = args.at(-1);
  assert.equal(args[0], '--json');
  assert.equal(args[1], '--limit');
  assert.ok(['1', '3', '6', '12'].includes(args[2]));
  assert.deepEqual(args.slice(3), ['--budget', '1400', 'search', '--', query]);
  assert.throws(() => mkdirSync('.llmdoc-tmp', { recursive: true }), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => writeFileSync('.llmdoc-tmp/cache/search-index.json', 'replace'), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => spawnSync('do-not-launch'), { code: 'ERR_ACCESS_DENIED' });
  if (query === 'timeout') await new Promise((resolve) => setTimeout(resolve, 30000));
  if (query === 'invalid json') { console.log('not json'); process.exit(0); }
  if (query === 'huge page' && Number(args[args.indexOf('--limit') + 1]) > 1)
    process.stdout.write('a'.repeat(200000));
  if (query === 'overflow') process.stdout.write('a'.repeat(200000));
  if (query === 'failure') { console.log('The document was unavailable'); process.exit(2); }
  if (query === 'bad output id') entry.path = 'llmdoc/../../secret.mdx';
  result = { query, results: [{ ...entry, snippet: query }], pagination };
} else if (command === 'show') {
  assert.deepEqual(args, ['--json', '--limit', '1', '--budget', '2000', 'show', id]);
  const body = readFileSync(id, 'utf8').includes('long preview fixture')
    ? 'x'.repeat(13000) : '# Example\n<script>plain text</script>';
  result = { documents: [{ ...entry, body }], pagination: { totalItems: 1, returnedItems: 1, nextCursor: null } };
} else if (command === 'context') {
  assert.deepEqual(args, ['--json', '--limit', '30', '--budget', '1400', ...(args.includes(cursor) ? ['--cursor', cursor] : []), 'context', '--files', 'src/future file.ts', 'already-deleted.ts']);
  assert.throws(() => git(['rev-parse', '--is-inside-work-tree']), { code: 'ERR_ACCESS_DENIED' });
  result = { impacted: [entry], prerequisites: [], unmappedFiles: ['already-deleted.ts'], pagination };
} else if (command === 'prune') {
  assert.deepEqual(args.slice(-2), ['prune', '--report']);
  assert.throws(() => git(['rev-parse', '--is-inside-work-tree']), { code: 'ERR_ACCESS_DENIED' });
  result = { status: 'dry_run', writable: false, growth: {}, startupPreloads: [], duplicateCandidates: [], mergeCandidates: [] };
} else if (command === 'status' || command === 'delta') {
  assert.equal(git(['rev-parse', '--is-inside-work-tree']).stdout.trim(), 'true');
  const head = safeGit('rev-parse', '--verify', 'HEAD').stdout.trim();
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(git(['cat-file', '-e', head + '^{commit}']).status, 0);
  assert.notEqual(git(['cat-file', '-e', '0'.repeat(40) + '^{commit}']).status, 0);
  assert.equal(safeGit('symbolic-ref', '--quiet', '--short', 'HEAD').status, 0);
  const gitDir = safeGit('rev-parse', '--git-dir').stdout.trim();
  assert.equal(existsSync(path.resolve(gitDir, 'MERGE_HEAD')), false);
  for (const args of [
    ['diff', '--name-only', '--no-renames', '--cached'], ['diff', '--name-only', '--no-renames'],
    ['diff', '--name-only', '--no-renames', head + '..' + head], ['ls-files', '--others', '--exclude-standard'],
    ['rev-list', '--count', head + '..' + head], ['log', '--format=%x01%H', '--name-only', '--no-renames', head + '..' + head],
  ]) assert.equal(safeGit(...args).status, 0);
  assert.throws(() => mkdirSync('.llmdoc-tmp'), { code: 'ERR_ACCESS_DENIED' });
  if (existsSync('fixture-unexpected-git')) {
    try { git(['status', '--short']); } catch { /* Pretend upstream swallowed this. */ }
  }
  result = command === 'status' ? { baseline: null, head, commitsBehindHead: null, relevantCommitsBehindHead: null, degradedReason: null, documents: summaries, unmapped, growth: {} }
    : { suggestedMode: 'light', reasons: [], degradedReason: null, impacted: [], needsReview: [id], unmapped, pagination };
  if (command === 'delta') assert.deepEqual(args.slice(-3), ['--cursor', cursor, 'delta']);
} else if (command === 'validate') {
  assert.equal(safeGit('rev-parse', '--is-shallow-repository').stdout.trim(), 'false');
  result = { ok: false, errors: [{ code: 'fixture.invalid', severity: 'error', message: 'Fixture validation error' }], warnings: [] };
  process.exitCode = 1;
} else if (command === 'upgrade') {
  assert.equal(existsSync('llmdoc/docs/nested/old.md'), true);
  assert.throws(() => writeFileSync('llmdoc/docs/nested/old.md', 'changed'), { code: 'ERR_ACCESS_DENIED' });
  result = { status: 'dry_run', summary: 'Legacy inventory', legacyPaths: ['docs/nested/old.md'], targetStructure: [], notes: [], requiresRecorderSemanticMigration: true };
} else throw new Error('Unexpected CLI command');
console.log(JSON.stringify(result));
`;

async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codekiln-llmdoc-')));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const projectRoot = join(dir, 'project');
  const packageRoot = join(dir, 'cli install', 'node_modules', '@tokenroll', 'llmdoc');
  const cliEntry = join(packageRoot, 'dist', 'bin', 'llmdoc.js');
  await mkdir(dirname(join(projectRoot, id)), { recursive: true });
  await mkdir(join(projectRoot, '.git'));
  await writeFile(join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(projectRoot, id), markdown);
  await mkdir(dirname(cliEntry), { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@tokenroll/llmdoc',
      version: '3.6.0',
      type: 'module',
      bin: { llmdoc: './dist/bin/llmdoc.js' },
    })
  );
  await writeFile(cliEntry, fakeCli);
  const config = { cliEntry, nodeExecutable: process.execPath };
  const context = { projectRoot, sessionId: 'fixture', signal: new AbortController().signal };
  const tools = new Map();
  const methods = new Map();
  const handlers = new Map();
  const injections = [];
  const dataDir = join(dir, 'plugin-data');
  await mkdir(dataDir);
  activate({
    dataDir,
    config: { get: async () => config },
    tools: { register: (name, handler) => tools.set(name, handler) },
    renderer: { handle: (name, handler) => methods.set(name, handler) },
    events: { on: (name, handler) => handlers.set(name, handler) },
    session: { inject: async (input) => injections.push(input) },
  });
  return { dir, projectRoot, packageRoot, config, context, tools, methods, handlers, injections };
}

test('sandbox methods and read-only agent tools share the pinned CLI contract', async (t) => {
  const { tools, methods, context, projectRoot } = await fixture(t);
  const { contributes, icon, name } = JSON.parse(
    await readFile(new URL('../enso-plugin.json', import.meta.url), 'utf8')
  );
  assert.equal(name, '知识地图');
  assert.equal(icon, 'icon.svg');
  assert.equal(contributes.views[0].title, '知识地图');
  await access(new URL('../icon.svg', import.meta.url));
  const expectedTools = [...readNames, 'runtime'].sort();
  const expectedMethods = [
    ...readNames.filter((name) => name !== 'upgrade'),
    'inspect',
    'install_cli',
    'prepare_workflow',
  ].sort();
  assert.deepEqual([...tools.keys()].sort(), expectedTools);
  assert.deepEqual(contributes.agentTools.map((tool) => tool.name).sort(), expectedTools);
  assert.ok(
    contributes.agentTools.every((tool) => tool.readOnly && tool.parameters.type === 'object')
  );
  assert.deepEqual([...methods.keys()].sort(), expectedMethods);
  assert.deepEqual(contributes.methods.map((method) => method.name).sort(), expectedMethods);

  const first = await methods.get('tree')(undefined, context);
  assert.deepEqual(first.entries, [{ id, description: 'An example', kind: 'guide' }]);
  assert.equal(first.nextCursor, firstCursor);
  await rm(join(projectRoot, '.git'), { recursive: true });
  await writeFile(join(projectRoot, '.git'), 'gitdir: ../git-main/.git/worktrees/project\n');
  const last = await methods.get('tree')({ cursor: first.nextCursor }, context);
  assert.equal(last.nextCursor, null);
  const result = await tools.get('show')({ id }, context);
  assert.deepEqual(JSON.parse(result.content), {
    id,
    kind: 'guide',
    description: 'An example',
    body: '# Example\n<script>plain text</script>',
  });
  await writeFile(join(projectRoot, id), `${markdown}\nlong preview fixture\n`);
  const preview = await methods.get('show')({ id }, context);
  assert.equal(preview.body, 'x'.repeat(12000));
  assert.equal(preview.bodyTruncated, true);
});

test('agent_end appends a review reminder from the read-only status check', async (t) => {
  const { handlers, injections, context, projectRoot } = await fixture(t);
  await rm(join(projectRoot, '.git'), { recursive: true });
  execFileSync('git', ['init', '-q', projectRoot]);
  execFileSync('git', ['-C', projectRoot, 'add', id]);
  execFileSync('git', [
    '-C',
    projectRoot,
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'user.name=Fixture',
    'commit',
    '-qm',
    'fixture',
  ]);
  await handlers.get('agent_end')({}, context);
  assert.equal(injections.length, 1);
  assert.match(injections[0].text, /1 篇待复核/);
  assert.equal(injections[0].deliverAs, 'followUp');
  assert.equal(injections[0].triggerTurn, false);
  assert.equal(await readFile(join(projectRoot, id), 'utf8'), markdown);
});

test('treats placeholder cursors as the first page instead of failing the CLI', async (t) => {
  const { tools, context } = await fixture(t);
  for (const cursor of ['0', '1', '', 'null', 'undefined']) {
    const result = await tools.get('search')({ query: 'fixture', cursor }, context);
    assert.equal(JSON.parse(result.content).entries[0].snippet, 'fixture');
  }
});

test('search treats a query as one literal argv item and cannot make or update the upstream cache', async (t) => {
  const { methods, projectRoot, context } = await fixture(t);
  const cache = join(projectRoot, '.llmdoc-tmp', 'cache', 'search-index.json');
  const oldSecret = process.env.LLMDOC_TEST_SECRET;
  const oldNodeOptions = process.env.NODE_OPTIONS;
  process.env.LLMDOC_TEST_SECRET = 'fixture only';
  process.env.NODE_OPTIONS = '--enable-source-maps';
  t.after(() => {
    if (oldSecret === undefined) delete process.env.LLMDOC_TEST_SECRET;
    else process.env.LLMDOC_TEST_SECRET = oldSecret;
    if (oldNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldNodeOptions;
  });
  const query = '检索 ; $(literal) --version --limit 999';
  const first = await methods.get('search')({ query: `  ${query}  ` }, context);
  assert.equal(first.entries[0].snippet, query);
  await assert.rejects(access(join(projectRoot, '.llmdoc-tmp')), { code: 'ENOENT' });
  await mkdir(dirname(cache), { recursive: true });
  await writeFile(cache, 'unchanged fixture cache');
  await methods.get('search')({ query }, context);
  assert.equal(await readFile(cache, 'utf8'), 'unchanged fixture cache');
  assert.equal(await readFile(join(projectRoot, id), 'utf8'), markdown);
});

test('rejects untrusted command, project, cursor and path arguments', async (t) => {
  const { methods, context, projectRoot } = await fixture(t);
  await assert.rejects(methods.get('tree')({ projectRoot }, context), /参数/);
  await assert.rejects(methods.get('tree')({ cursor: '--version' }, context), /游标/);
  await assert.rejects(methods.get('tree')({ cursor: `${firstCursor}\n` }, context), /游标/);
  for (const query of ['--version', '-V', ' ', 'a\nb', 'a'.repeat(201)]) {
    await assert.rejects(methods.get('search')({ query }, context), /关键词/);
  }
  for (const bad of [
    '../../secret.mdx',
    '/tmp/secret.mdx',
    'llmdoc/../secret.mdx',
    'llmdoc\\x.mdx',
    'llmdoc/C:secret.mdx',
    'llmdoc/./x.mdx',
    'llmdoc/x.mdx ',
  ]) {
    await assert.rejects(methods.get('show')({ id: bad }, context), /文档 ID/);
  }
  await assert.rejects(
    methods.get('tree')(undefined, { ...context, sessionId: null }),
    /本机 Code/
  );
  await assert.rejects(
    methods.get('tree')(undefined, { ...context, projectRoot: join(projectRoot, 'llmdoc') }),
    /Git/
  );
  await rm(join(projectRoot, 'llmdoc'), { force: true, recursive: true });
  await assert.rejects(methods.get('tree')(undefined, context), /缺少 llmdoc\//);
});

test('rejects unsafe front matter and symlinked content before any CLI read', async (t) => {
  const { methods, context, projectRoot, dir } = await fixture(t);
  const unsafe = join(projectRoot, 'llmdoc', 'other.mdx');
  await writeFile(unsafe, '\ufeff---js\r\nfixture sentinel\r\n---\r\n');
  await assert.rejects(methods.get('tree')(undefined, context), /YAML/);
  await rm(unsafe);
  if (process.platform !== 'win32') {
    const outside = join(dir, 'outside.mdx');
    await writeFile(outside, markdown);
    await symlink(outside, unsafe);
    await assert.rejects(methods.get('show')({ id: 'llmdoc/other.mdx' }, context), /符号链接/);
  }
});

test('rejects missing, relative and unpinned executable configuration', async (t) => {
  const { methods, config, packageRoot, context } = await fixture(t);
  const entry = config.cliEntry;
  config.cliEntry = './llmdoc.js';
  await assert.rejects(methods.get('tree')(undefined, context), /绝对路径/);
  config.cliEntry = entry;
  config.nodeExecutable = join(packageRoot, 'missing-node');
  await assert.rejects(methods.get('tree')(undefined, context), /Node/);
  config.nodeExecutable = process.execPath;
  await writeFile(
    join(packageRoot, 'package.json'),
    '{"name":"@tokenroll/llmdoc","version":"3.6.1"}'
  );
  await assert.rejects(methods.get('tree')(undefined, context), /3\.6\.0/);
});

test('reports CLI failures, invalid protocol and overflowing stdout without returning partial data', async (t) => {
  const { methods, context } = await fixture(t);
  const search = methods.get('search');
  await assert.rejects(search({ query: 'failure' }, context), /The document was unavailable/);
  await assert.rejects(search({ query: 'invalid json' }, context), /JSON/);
  await assert.rejects(search({ query: 'bad output id' }, context), /文档 ID/);
  await assert.rejects(search({ query: 'overflow' }, context), /输出超过/);
});

test('a list query over the byte budget narrows itself instead of returning no page', async (t) => {
  const { methods, context } = await fixture(t);
  const result = await methods.get('search')({ query: 'huge page' }, context);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, id);
  assert.equal(result.narrowed, true);
  assert.equal(result.limit, 1);
});

test('times out a hung subprocess and handles invocation cancellation', async (t) => {
  const { methods, context } = await fixture(t);
  const search = methods.get('search');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  t.after(() => clearTimeout(timer));
  await assert.rejects(
    search({ query: 'timeout' }, { ...context, signal: controller.signal }),
    /取消/
  );
  await assert.rejects(search({ query: 'timeout' }, context), /超时/);
});

const fixtureGitEnv = () => ({
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  ...(process.platform === 'win32' && process.env.SystemRoot
    ? { SystemRoot: process.env.SystemRoot }
    : {}),
});

async function gitFixture(t, fx) {
  let git;
  for (const path of (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    const candidate = join(path, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      execFileSync(candidate, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: fixtureGitEnv(),
      });
      git = candidate;
      break;
    } catch {
      // This real-Git fixture is optional on systems without an installed binary.
    }
  }
  if (!git) return t.skip('Independent Git executable not available.');
  fx.config.gitExecutable = git;
  const run = (...args) =>
    execFileSync(git, args, {
      cwd: fx.projectRoot,
      env: fixtureGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  await rm(join(fx.projectRoot, '.git'), { recursive: true });
  run('init', '--template=', '--initial-branch=main');
  run('add', '--', id);
  run('commit', '--no-gpg-sign', '-m', 'Fixture');
  return run;
}

test('context supports bounded missing paths and pagination without Git while rejecting flags, traversal and symlinks', async (t) => {
  const { context, methods, projectRoot, dir } = await fixture(t);
  const call = methods.get('context');
  const files = ['src/future file.ts', 'already-deleted.ts'];
  const first = await call({ files }, context);
  assert.equal(first.operation, 'context');
  assert.equal(first.exitCode, 0);
  assert.equal(first.result.impacted[0].path, id);
  const next = await call({ files, cursor: first.result.pagination.nextCursor }, context);
  assert.equal(next.result.pagination.nextCursor, null);
  for (const bad of [
    [],
    ['-V'],
    ['../a'],
    ['src/./a'],
    ['C:/a'],
    ['/tmp/a'],
    ['src\\a'],
    ['src\na'],
    Array.from({ length: 40 }, (_, i) => `src/${i}`),
  ]) {
    await assert.rejects(call({ files: bad }, context), /源码路径/);
  }
  if (process.platform !== 'win32') {
    await symlink(dir, join(projectRoot, 'outside'));
    await assert.rejects(call({ files: ['outside/not-yet-created.ts'] }, context), /符号链接/);
  }
  assert.equal((await methods.get('prune_report')({}, context)).result.writable, false);
});

test('pinned read Git handles intended calls, explicit validation failure and legacy inventory without updates', async (t) => {
  const fx = await fixture(t);
  const git = await gitFixture(t, fx);
  if (!git) return;
  const { context, methods, projectRoot, tools } = fx;
  const index = await readFile(join(projectRoot, '.git', 'index'));
  const status = await methods.get('status')({}, context);
  assert.equal(status.result.head, git('rev-parse', 'HEAD').trim());
  const delta = JSON.parse((await tools.get('delta')({ cursor: firstCursor }, context)).content);
  assert.deepEqual(delta.result.needsReview, [id]);
  const validate = await methods.get('validate')({}, context);
  assert.equal(validate.exitCode, 1);
  assert.equal(validate.result.ok, false);
  const legacy = join(projectRoot, 'llmdoc', 'docs', 'nested', 'old.md');
  await mkdir(dirname(legacy), { recursive: true });
  await writeFile(legacy, '# Old knowledge');
  const upgrade = JSON.parse((await tools.get('upgrade')({}, context)).content);
  assert.deepEqual(upgrade.result.legacyPaths, ['docs/nested/old.md']);
  assert.equal(await readFile(legacy, 'utf8'), '# Old knowledge');
  assert.deepEqual(await readFile(join(projectRoot, '.git', 'index')), index);
  assert.equal(git('rev-parse', 'HEAD').trim(), status.result.head);
});

test('Git diagnostics fail closed for an invalid override, unsafe config, or a swallowed Git call', async (t) => {
  const fx = await fixture(t);
  const { context, methods, projectRoot, config } = fx;
  config.gitExecutable = './git';
  await assert.rejects(methods.get('status')({}, context), /Git.*绝对路径/);
  const git = await gitFixture(t, fx);
  if (!git) return;
  await writeFile(join(projectRoot, 'fixture-unexpected-git'), 'fixture only');
  await assert.rejects(methods.get('status')({}, context), /Git.*拒绝/);
  await rm(join(projectRoot, 'fixture-unexpected-git'));
  git('config', '--local', 'filter.fixture.clean', 'do-not-run-fixture-filter');
  await assert.rejects(methods.get('status')({}, context), /Git.*filter/);
  git('config', '--local', '--unset', 'filter.fixture.clean');
  await writeFile(join(projectRoot, '.git', 'index'), 'corrupt fixture index');
  await assert.rejects(methods.get('status')({}, context), /Git diff 退出失败/);
});
