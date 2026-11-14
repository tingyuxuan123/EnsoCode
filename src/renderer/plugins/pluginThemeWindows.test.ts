import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 每个窗口都是独立 renderer 入口，不会自动继承主窗口的 `html` 主题类/插件调色板：
 * 跟随应用外观的入口必须在自己的组件树里挂 PluginThemeHost，否则该窗口永远停在云白
 * （协作看板踩过：入口漏挂宿主，插件主题与调色板全部无效）。
 *
 * 明确不在此列的非应用 UI 入口：`public/plugin-view.html`（插件沙箱自带 enso.theme 桥，
 * 主题由父页面推送）、配对预览/设计画布的沙箱 iframe 与离屏预览窗口（无 preload）、
 * 通用 PDF/导出预览窗口（系统查看器，无宿主文档）。
 */
const renderer = path.resolve(__dirname, '..');
const source = (file: string) => readFileSync(path.join(renderer, file), 'utf8');

const THEMED_WINDOWS = ['App.tsx', 'settings.tsx', 'taskboard.tsx', 'design-window.tsx'];

describe('独立窗口的基础主题接入', () => {
  it.each(THEMED_WINDOWS)('%s 挂载插件主题宿主', (entry) => {
    const code = source(entry);
    expect(code).toMatch(/from '@\/plugins\/PluginThemeHost'/);
    expect(code).toMatch(/<PluginThemeHost\s*\/>/);
  });

  // 会话活动属性依赖 sessions store（持久化在 settings.json）；只有主窗口既有会话状态
  // 又有 data-enso 素材挂点，第二个窗口导入会写回过期快照。
  it('会话活动属性只在主窗口订阅', () => {
    expect(source('App.tsx')).toMatch(/<SessionActivityAttributes\s*\/>/);
    for (const entry of THEMED_WINDOWS.filter((file) => file !== 'App.tsx'))
      expect(source(entry)).not.toMatch(/SessionActivityAttributes/);
  });
});
