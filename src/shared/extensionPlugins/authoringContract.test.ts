import { describe, expect, it } from 'vitest';
import {
  AUTHORING_TEMPLATES,
  authoringCapabilities,
  preflightAuthoringManifest,
  recommendAuthoringTemplate,
} from './authoringContract';
import { parseExtensionPluginManifest } from './manifest';

function manifest(extra: Record<string, unknown> = {}) {
  const result = parseExtensionPluginManifest(
    {
      schemaVersion: 1,
      id: 'org.example.notes',
      name: 'Notes',
      version: '1.0.0',
      main: 'main.mjs',
      permissions: [],
      ...extra,
    },
    '0.2.110'
  );
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.manifest;
}

describe('authoring contract', () => {
  it('recommends explicit no-UI tools and short commands before knowledge/workspace defaults', () => {
    expect(AUTHORING_TEMPLATES.map((t) => t.id)).toEqual([
      'workspace',
      'sidebar',
      'command',
      'tool',
    ]);
    for (const text of ['记忆管理', 'knowledge manager', '', '项目笔记'])
      expect(recommendAuthoringTemplate(text)).toBe('workspace');
    for (const text of ['临时辅助查看项目', 'sidebar helper', '侧栏查看知识', '临时辅助管理笔记'])
      expect(recommendAuthoringTemplate(text)).toBe('sidebar');
    for (const text of [
      '无界面模型工具查询知识',
      'read-only model tool',
      '模型可调用的工具查询知识',
    ])
      expect(recommendAuthoringTemplate(text)).toBe('tool');
    for (const text of ['短命令弹出提醒', 'command to notify', '无 UI 的命令管理知识'])
      expect(recommendAuthoringTemplate(text)).toBe('command');
  });

  it('reports actual current capabilities independently of version, without private state', () => {
    const current = authoringCapabilities('0.2.110');
    expect(authoringCapabilities('0.0.1').features).toEqual(current.features);
    expect(current.features).toEqual(
      expect.arrayContaining([
        'ui.view',
        'views.activitybar',
        'commands',
        'agent.tool',
        'renderer.methods',
      ])
    );
    expect(JSON.parse(JSON.stringify(current))).toEqual(current);
    expect(current.guide).toContain('不是操作系统沙箱');
    expect(current.guide).toContain('composer.activity');
    expect(current.guide).toContain('旧宿主');
    expect(JSON.stringify(current)).not.toMatch(/\/Users\/|apiKey|process\.env/);
  });

  it('checks declared APIs, view locations and engines without executing code', () => {
    const value = manifest({
      permissions: ['ui.view'],
      contributes: {
        views: [{ id: 'notes', title: 'Notes', entry: 'view.html', location: 'activitybar' }],
      },
    });
    const caps = authoringCapabilities('0.2.110');
    expect(preflightAuthoringManifest(value, caps).errors).toEqual([]);
    expect(preflightAuthoringManifest(value, caps).warnings.join('\n')).toMatch(/engines/);
    expect(preflightAuthoringManifest(value, caps).warnings.join('\n')).toMatch(/--panel/);
    const missing = preflightAuthoringManifest(value, { ...caps, features: [] });
    expect(missing.errors.join('\n')).toContain('ui.view');
    expect(missing.errors.join('\n')).toContain('views.activitybar');
    expect(
      preflightAuthoringManifest({ ...value, ensoRange: '>=9.0.0' }, caps).errors.join('\n')
    ).toContain('engines');
    const renderer = preflightAuthoringManifest(
      manifest({ renderer: 'ui.js', permissions: ['ui.slot'] }),
      caps
    );
    expect(renderer.warnings.join('\n')).toContain('composer.dock');
  });
});
