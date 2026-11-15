import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Exercise the CLI against an isolated knowledge base, never the developer's memory files.
const source = readFileSync(new URL('./knowledge.ts', import.meta.url), 'utf8');

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'collabra-knowledge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (relative, content = '') => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  };
  write('AGENTS.md');
  write('docs/engineering-guidelines.md');
  write('.agents/skills/project-knowledge/SKILL.md');
  write('package.json', '{"type":"module"}\n');
  // Node strips the TypeScript annotations itself; the CLI stays the real implementation.
  const script = write('scripts/knowledge.ts', source);
  return {
    write,
    check: () => spawnSync(process.execPath, [script, 'check'], { encoding: 'utf8' }),
  };
}

test('knowledge check accepts existing angle-bracket memory paths with spaces and anchors', (t) => {
  const { write, check } = fixture(t);
  const memory = write('local memory/项目记忆.md', '# 主题\n');
  write('AGENTS.md', `[项目记忆](<${memory}#主题>)\n`);
  const result = check();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No broken links found/);
});

test('knowledge check resolves plain and angle-bracket links from the skill directory', (t) => {
  const { write, check } = fixture(t);
  write(
    '.agents/skills/project-knowledge/SKILL.md',
    '[规范](../../../docs/engineering-guidelines.md#开发前)\n' +
      '[规范](<../../../docs/engineering-guidelines.md#开发前>)\n'
  );
  const result = check();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('knowledge check still fails on missing plain and angle-bracket targets', (t) => {
  const { write, check } = fixture(t);
  write('AGENTS.md', '[缺失](missing.md#主题)\n[缺失](<missing file.md#主题>)\n');
  const result = check();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /AGENTS\.md -> missing\.md/);
  assert.match(result.stdout, /AGENTS\.md -> missing file\.md/);
  assert.match(result.stdout, /2 broken link\(s\) found/);
});

test('knowledge check ignores external URLs and same-document anchors', (t) => {
  const { write, check } = fixture(t);
  write(
    'AGENTS.md',
    '[外部](https://example.invalid/docs#主题)\n' +
      '[外部](<https://example.invalid/docs#主题>)\n[本页](#主题)\n'
  );
  const result = check();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
