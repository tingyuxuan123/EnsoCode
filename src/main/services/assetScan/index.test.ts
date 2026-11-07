import fs from 'node:fs';
import path from 'node:path';
import { ASSET_SOURCE_IDS } from '@shared/types/assetScan';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const dir = require('node:fs').mkdtempSync(`${require('node:os').tmpdir()}/enso-headers-scan-`);
  return { dir, file: `${dir}/settings.json`, state: {} as Record<string, unknown> };
});
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => fixture.dir } };
});
vi.mock('../../ipc/settings', () => ({
  readSettings: () => ({ 'enso-settings': { state: fixture.state } }),
}));
vi.mock('../providerScan/locations', () => ({ locateApp: () => ({ filePath: fixture.file }) }));

import { collectAssetImport, scanLocalAssets } from './index';

beforeEach(() => {
  fs.mkdirSync(fixture.dir, { recursive: true });
  fixture.state = {};
});
afterEach(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));

function skill(source: '.agents' | '.claude', dir: string, name: string) {
  const root = path.join(fixture.dir, source, 'skills', dir);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: local skill\n---\nbody`
  );
  return root;
}

it('Agents 来源报告缺目录，目录存在时扫描并显式收集，不自动启用', () => {
  expect(ASSET_SOURCE_IDS).toContain('agents');
  expect(scanLocalAssets().sources.find((s) => s.sourceId === 'agents')).toMatchObject({
    status: 'not-found',
    skillCount: 0,
  });
  const root = skill('.agents', 'verify', 'verify');
  const scan = scanLocalAssets();
  expect(scan.sources.find((s) => s.sourceId === 'agents')).toMatchObject({
    status: 'found',
    skillCount: 1,
    mcpCount: 0,
    instructionCount: 0,
  });
  const candidate = scan.candidates.find((c) => c.sourceId === 'agents');
  expect(candidate).toMatchObject({
    kind: 'skill',
    name: 'verify',
    path: '~/.agents/skills/verify',
    duplicated: false,
  });
  expect(collectAssetImport(scan.scanId, [candidate!.id])).toEqual([
    expect.objectContaining({
      kind: 'skill',
      name: 'verify',
      path: root,
      source: 'Agents (~/.agents)',
    }),
  ]);
  expect(collectAssetImport(scan.scanId, [candidate!.id])[0]).not.toHaveProperty('enabled');
  expect(collectAssetImport('stale-scan', [candidate!.id])).toEqual([]);
});

it('Agents 同名技能跨来源与已登记条目都标记重复，收集阶段批内去重', () => {
  skill('.claude', 'verify', 'Verify');
  skill('.agents', 'verify', 'verify');
  let scan = scanLocalAssets();
  expect(scan.candidates.find((c) => c.sourceId === 'agents')).toMatchObject({
    duplicated: true,
    duplicateReason: 'same-name',
  });
  expect(
    collectAssetImport(
      scan.scanId,
      scan.candidates.map((c) => c.id)
    )
  ).toHaveLength(1);
  fixture.state = { skills: [{ name: 'VERIFY', path: '/some/registered/skill' }] };
  scan = scanLocalAssets();
  expect(scan.candidates.find((c) => c.sourceId === 'agents')).toMatchObject({
    duplicated: true,
    duplicateReason: 'registered',
  });
});

it('Agents 坏 frontmatter 和悬空链接不阻断其他来源，沿用目录链接发现行为', () => {
  const root = skill('.agents', 'bad', 'bad');
  fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nname: [invalid\n---\nbody');
  const linked = skill('.agents', 'real', 'real');
  fs.symlinkSync(linked, path.join(fixture.dir, '.agents', 'skills', 'linked'), 'junction');
  fs.symlinkSync(
    path.join(fixture.dir, 'missing'),
    path.join(fixture.dir, '.agents', 'skills', 'dangling'),
    'junction'
  );
  skill('.claude', 'other', 'other');
  const scan = scanLocalAssets();
  expect(scan.candidates.filter((c) => c.sourceId === 'agents').map((c) => c.name)).toEqual([
    'bad',
    'real',
    'real',
  ]);
  expect(scan.candidates.find((c) => c.sourceId === 'claude-code')).toMatchObject({
    name: 'other',
  });
});

it('扫描候选不泄漏 headers，确认导入保留完整 headers', () => {
  fs.writeFileSync(
    fixture.file,
    JSON.stringify({
      'enso-settings': {
        state: {
          mcpServers: [
            {
              name: 'remote',
              url: 'https://example.test/mcp',
              headers: { Authorization: 'Bearer fake-scan-token' },
            },
          ],
        },
      },
    })
  );
  const scan = scanLocalAssets();
  const candidate = scan.candidates.find((item) => item.kind === 'mcp');
  expect(candidate).toBeDefined();
  expect(JSON.stringify(scan)).not.toContain('fake-scan-token');
  expect(candidate).not.toHaveProperty('headers');
  expect(collectAssetImport(scan.scanId, [candidate!.id])).toMatchObject([
    { headers: { Authorization: 'Bearer fake-scan-token' } },
  ]);
});
